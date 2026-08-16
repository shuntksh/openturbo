import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTestProject } from "./utils";

describe("Integration: Reliability and Output", () => {
	if (process.platform === "darwin" || process.platform === "linux") {
		test("external containment is empty before terminal control returns", async () => {
			const project = await createTestProject(
				"reliability-inherited-containment",
			);
			await project.writeFile(
				"containment-probe.ts",
				`import { dlopen } from "bun:ffi";
const libc = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
  getpgrp: { args: [], returns: "i32" },
});
await Bun.write("workflow-process.json", JSON.stringify({ pid: process.pid, pgid: libc.symbols.getpgrp() }));
setInterval(() => {}, 50);`,
			);
			await project.writeJson("workflows.json", {
				cancel: {
					steps: [
						{
							name: "contained-command",
							cmd: "bun containment-probe.ts",
						},
					],
				},
			});

			const cliPath = join(process.cwd(), "src/cmd.ts");
			const proc = Bun.spawn(["bun", "run", cliPath, "cancel", "--no-color"], {
				cwd: project.dir,
				detached: true,
				env: { ...process.env, OT_PROCESS_CONTAINMENT: "inherited" },
				stderr: "ignore",
				stdout: "ignore",
			});
			let workflowPid: number | undefined;
			try {
				const pidPath = join(project.dir, "workflow-process.json");
				const deadline = Date.now() + 5000;
				while (!existsSync(pidPath) && Date.now() < deadline) {
					await Bun.sleep(25);
				}
				expect(existsSync(pidPath)).toBe(true);
				const workflowProcess = (await Bun.file(pidPath).json()) as {
					pid: number;
					pgid: number;
				};
				workflowPid = workflowProcess.pid;
				expect(workflowProcess.pgid).toBe(proc.pid);

				// The external owner cancels its complete process group before it lets
				// the shell print the next prompt. No nested OT group can survive here.
				process.kill(-proc.pid, "SIGKILL");
			} finally {
				try {
					process.kill(-proc.pid, "SIGKILL");
				} catch {}
				if (workflowPid !== undefined) {
					try {
						process.kill(-workflowPid, "SIGKILL");
					} catch {}
				}
				await proc.exited;
				await project.cleanup();
			}
		}, 10_000);

		test("one inherited SIGINT cancels parallel, workspace, and nested commands", async () => {
			const project = await createTestProject(
				"reliability-inherited-cancellation-matrix",
			);
			const cliPath = join(process.cwd(), "src/cmd.ts");
			const probePath = join(project.dir, "cancellation-probe.ts");
			await project.writeFile(
				"cancellation-probe.ts",
				`import { dlopen } from "bun:ffi";
const libc = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
  getpgrp: { args: [], returns: "i32" },
});
const [readyPath, leakPath] = process.argv.slice(2);
await Bun.write(readyPath, JSON.stringify({ pid: process.pid, pgid: libc.symbols.getpgrp() }));
setTimeout(() => Bun.write(leakPath, "survived"), 700);
setInterval(() => {}, 50);`,
			);

			const probes = [
				"parallel-a",
				"parallel-b",
				"workspace-a",
				"workspace-b",
				"nested",
			];
			const probeCommand = (name: string) =>
				`bun ${JSON.stringify(probePath)} ${JSON.stringify(join(project.dir, `${name}.json`))} ${JSON.stringify(join(project.dir, `${name}.leak`))}`;

			await project.writeJson("package.json", {
				name: "root",
				workspaces: ["packages/*"],
			});
			await project.writeJson("packages/a/package.json", {
				name: "workspace-a",
				scripts: { hang: probeCommand("workspace-a") },
			});
			await project.writeJson("packages/b/package.json", {
				name: "workspace-b",
				scripts: { hang: probeCommand("workspace-b") },
			});
			await project.writeJson("workflows.json", {
				inner: {
					steps: [{ name: "inner-command", cmd: probeCommand("nested") }],
				},
				cancel: {
					steps: [
						{ name: "parallel-a", cmd: probeCommand("parallel-a") },
						{ name: "parallel-b", cmd: probeCommand("parallel-b") },
						{
							name: "workspaces",
							bun: { script: "hang", parallel: -1 },
						},
						{
							name: "nested",
							cmd: `bun run ${JSON.stringify(cliPath)} inner --no-color`,
						},
					],
				},
			});

			const proc = Bun.spawn(["bun", "run", cliPath, "cancel", "--no-color"], {
				cwd: project.dir,
				detached: true,
				env: { ...process.env, OT_PROCESS_CONTAINMENT: "inherited" },
				stderr: "ignore",
				stdout: "ignore",
			});
			try {
				const deadline = Date.now() + 5000;
				while (
					!probes.every((name) =>
						existsSync(join(project.dir, `${name}.json`)),
					) &&
					Date.now() < deadline
				) {
					await Bun.sleep(25);
				}
				for (const name of probes) {
					const statePath = join(project.dir, `${name}.json`);
					expect(existsSync(statePath)).toBe(true);
					const state = (await Bun.file(statePath).json()) as { pgid: number };
					expect(state.pgid).toBe(proc.pid);
				}

				process.kill(-proc.pid, "SIGINT");
				expect(await proc.exited).toBe(130);
				await Bun.sleep(900);
				for (const name of probes) {
					expect(existsSync(join(project.dir, `${name}.leak`))).toBe(false);
				}
			} finally {
				try {
					process.kill(-proc.pid, "SIGKILL");
				} catch {}
				await proc.exited;
				await project.cleanup();
			}
		}, 10_000);
	}

	test("should preserve failure details in large outputs", async () => {
		const project = await createTestProject("reliability-truncation");

		await project.writeJson("workflows.json", {
			"fail-large": {
				steps: [
					{
						name: "large-fail",
						cmd: `bun -e "for(let i=0; i<150; i++) console.log('line ' + i); console.error('CRITICAL ERROR HERE'); process.exit(1)"`,
					},
				],
			},
		});

		const result = await project.runCLI(["fail-large"]);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("CRITICAL ERROR HERE");

		await project.cleanup();
	});

	test("should resolve complex workspace dependencies recursively", async () => {
		const project = await createTestProject("reliability-workspace-deps");

		await project.writeJson("package.json", {
			name: "root",
			workspaces: ["packages/*"],
		});

		await project.writeJson("packages/lib/package.json", {
			name: "lib",
			scripts: {
				build: "echo 'LIB BUILD'",
				test: "echo 'LIB TEST'",
			},
		});
		await project.writeJson("packages/app/package.json", {
			name: "app",
			scripts: {
				test: "echo 'APP TEST'",
			},
			dependencies: { lib: "*" },
		});

		await project.writeJson("workflows.json", {
			"test-all": {
				steps: [
					{
						name: "test",
						bun: {
							script: "test",
							dependsOn: ["^build", "build"],
						},
					},
				],
			},
		});

		const result = await project.runCLI(["test-all", "-v"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("[lib] LIB BUILD");
		expect(result.output).toContain("[lib] LIB TEST");
		expect(result.output).toContain("[app] APP TEST");

		const output = result.output;
		const buildIndex = output.indexOf("[lib] LIB BUILD");
		const libTestIndex = output.indexOf("[lib] LIB TEST");
		const appTestIndex = output.indexOf("[app] APP TEST");

		expect(buildIndex).toBeLessThan(libTestIndex);
		expect(buildIndex).toBeLessThan(appTestIndex);

		await project.cleanup();
	});

	test("should kill workspace scripts after hard timeout seconds", async () => {
		const project = await createTestProject("reliability-hard-timeout");

		await project.writeJson("package.json", {
			name: "root",
			workspaces: ["packages/*"],
		});
		await project.writeJson("packages/app/package.json", {
			name: "app",
			scripts: {
				hang: "bun -e \"setTimeout(async () => { await Bun.write('timeout-marker.txt', 'alive'); }, 1000); setInterval(() => {}, 50);\"",
			},
		});
		await project.writeJson("workflows.json", {
			"hang-all": {
				steps: [
					{
						name: "hang",
						bun: {
							script: "hang",
							hardTimeoutSeconds: 0.2,
						},
					},
				],
			},
		});

		const startedAt = performance.now();
		const result = await project.runCLI(["hang-all"]);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("Hard timeout after 0.20s");
		expect(performance.now() - startedAt).toBeLessThan(2500);

		await Bun.sleep(1200);
		expect(
			existsSync(join(project.dir, "packages/app/timeout-marker.txt")),
		).toBe(false);

		await project.cleanup();
	});

	test("should kill active command trees when the workflow is terminated", async () => {
		const project = await createTestProject("reliability-cancellation");
		const delayedChild = Buffer.from(
			`setTimeout(() => Bun.write("cancel-marker.txt", "alive"), 1200); setInterval(() => {}, 50);`,
		).toString("base64");
		const command = `bun -e "await Bun.write('ready.txt', 'ready'); Bun.spawn(['bun', '-e', Buffer.from('${delayedChild}', 'base64').toString()], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }); setInterval(() => {}, 50)"`;

		await project.writeJson("workflows.json", {
			cancel: { steps: [{ name: "hang", cmd: command }] },
		});

		const cliPath = join(process.cwd(), "src/cmd.ts");
		const proc = Bun.spawn(["bun", "run", cliPath, "cancel"], {
			cwd: project.dir,
			stderr: "ignore",
			stdout: "ignore",
		});
		try {
			const readyPath = join(project.dir, "ready.txt");
			const deadline = Date.now() + 5000;
			while (!existsSync(readyPath) && Date.now() < deadline) {
				await Bun.sleep(25);
			}
			expect(existsSync(readyPath)).toBe(true);

			// Windows must survive abrupt supervisor death through KILL_ON_JOB_CLOSE;
			// POSIX receives a catchable termination request so it can kill its groups.
			proc.kill(process.platform === "win32" ? "SIGKILL" : "SIGTERM");
			await proc.exited;
			await Bun.sleep(1500);
			expect(existsSync(join(project.dir, "cancel-marker.txt"))).toBe(false);
		} finally {
			try {
				proc.kill("SIGKILL");
			} catch {}
			await project.cleanup();
		}
	});

	if (process.platform === "win32") {
		test("nested workflows reuse inherited Windows containment", async () => {
			const project = await createTestProject("reliability-nested-owner");
			const cliPath = join(process.cwd(), "src/cmd.ts");
			const delayedChild = Buffer.from(
				`setTimeout(() => Bun.write("nested-leak.txt", "alive"), 700); setInterval(() => {}, 50);`,
			).toString("base64");
			await project.writeJson("workflows.json", {
				inner: {
					steps: [
						{
							name: "inner-command",
							cmd: `bun -e "if (process.env.OT_PROCESS_OWNER_WINDOWS_JOB !== '1') process.exit(2); const child = Bun.spawn(['bun', '-e', Buffer.from('${delayedChild}', 'base64').toString()], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }); child.unref(); await Bun.write('nested-owned.txt', 'yes')"`,
						},
					],
				},
				outer: {
					steps: [
						{
							name: "nested-ot",
							cmd: `bun run ${JSON.stringify(cliPath)} inner --no-color`,
						},
					],
				},
			});

			try {
				const result = await project.runCLI(["outer"]);
				expect(result.exitCode).toBe(0);
				expect(existsSync(join(project.dir, "nested-owned.txt"))).toBe(true);
				await Bun.sleep(900);
				expect(existsSync(join(project.dir, "nested-leak.txt"))).toBe(false);
			} finally {
				await project.cleanup();
			}
		}, 10_000);
	}
});
