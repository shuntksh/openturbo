import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCmdAction } from "../src/actions/cmd";

function backgroundChildCommand(marker: string, exitCode: number): string {
	const child = Buffer.from(
		`setTimeout(() => Bun.write(${JSON.stringify(marker)}, "alive"), 600); setInterval(() => {}, 50);`,
	).toString("base64");
	const parent = Buffer.from(
		`const child = Bun.spawn(["bun", "-e", Buffer.from("${child}", "base64").toString()], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }); child.unref(); process.exit(${exitCode});`,
	).toString("base64");
	return `bun -e "eval(Buffer.from('${parent}', 'base64').toString())"`;
}

describe("runCmdAction", () => {
	test("captures stderr", async () => {
		// Command that writes to stderr and fails using Bun script to avoid shell syntax issues
		const cmd = `bun -e "console.error('error message'); process.exit(1)"`;
		const result = await runCmdAction(cmd, { verbose: false });

		expect(result.success).toBe(false);
		expect(result.output).toContain("error message");
	});

	test("passes changed files as argv and env", async () => {
		const cmd = `bun -e "console.log(process.argv.slice(1).join('|')); console.log(process.env.OT_CHANGED_FILES_JSON)"`;
		const result = await runCmdAction(cmd, {
			appendChangedFiles: true,
			changedFiles: ["src/a.ts", "src/with space.ts"],
			changedFilesSpecified: true,
			verbose: false,
		});

		expect(result.success).toBe(true);
		expect(result.output).toContain("src/a.ts|src/with space.ts");
		expect(result.output).toContain('["src/a.ts","src/with space.ts"]');
	});

	test("drains large stdout and stderr while waiting for exit", async () => {
		const cmd = `bun -e "for (let i = 0; i < 3000; i++) console.log('out' + i); for (let i = 0; i < 3000; i++) console.error('err' + i)"`;
		const result = await runCmdAction(cmd, { verbose: false });

		expect(result.success).toBe(true);
		expect(result.output).toContain("out2999");
		expect(result.output).toContain("err2999");
	});

	for (const [label, exitCode, success] of [
		["successful", 0, true],
		["failed", 1, false],
	] as const) {
		test(`cleans up background descendants after a ${label} command`, async () => {
			const marker = join(
				process.cwd(),
				`.ot-process-tree-${label}-${crypto.randomUUID()}.tmp`,
			);
			try {
				const result = await runCmdAction(
					backgroundChildCommand(marker, exitCode),
					{ verbose: false },
				);
				expect(result.success).toBe(success);

				await Bun.sleep(900);
				expect(existsSync(marker)).toBe(false);
			} finally {
				if (existsSync(marker)) rmSync(marker);
			}
		});
	}

	test("releases a descendant-held TCP port before returning", async () => {
		const reservation = Bun.listen({
			hostname: "127.0.0.1",
			port: 0,
			socket: { data() {} },
		});
		const port = reservation.port;
		reservation.stop(true);
		const marker = join(
			process.cwd(),
			`.ot-process-port-${crypto.randomUUID()}.tmp`,
		);
		const server = Buffer.from(
			`Bun.listen({ hostname: "127.0.0.1", port: ${port}, socket: { data() {} } }); await Bun.write(${JSON.stringify(marker)}, "ready"); setInterval(() => {}, 50);`,
		).toString("base64");
		const parent = Buffer.from(
			`(async () => { const p = Bun.spawn(["bun", "-e", Buffer.from("${server}", "base64").toString()], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }); p.unref(); while (!(await Bun.file(${JSON.stringify(marker)}).exists())) await Bun.sleep(10); })()`,
		).toString("base64");

		try {
			const result = await runCmdAction(
				`bun -e "await eval(Buffer.from('${parent}', 'base64').toString())"`,
				{ verbose: false },
			);
			expect(result.success).toBe(true);

			const rebound = Bun.listen({
				hostname: "127.0.0.1",
				port,
				socket: { data() {} },
			});
			rebound.stop(true);
		} finally {
			if (existsSync(marker)) rmSync(marker);
		}
	});
});
