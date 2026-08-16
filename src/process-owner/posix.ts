import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	hasInheritedProcessContainment,
	inheritProcessContainment,
} from "./containment";
import type { OwnedProcess, OwnedSpawnOptions, ProcessOwner } from "./types";

const OWNER_MARKER = "OT_PROCESS_OWNER_POSIX";

const POSIX_HOST = `
try { await Bun.file(process.env.OT_HOST_CONFIG_PATH).unlink(); } catch {}
const childEnv = { ...process.env };
if (process.env.OT_CHILD_BUN_OPTIONS !== undefined) childEnv.BUN_OPTIONS = process.env.OT_CHILD_BUN_OPTIONS;
else delete childEnv.BUN_OPTIONS;
if (process.env.OT_CHILD_NODE_OPTIONS !== undefined) childEnv.NODE_OPTIONS = process.env.OT_CHILD_NODE_OPTIONS;
else delete childEnv.NODE_OPTIONS;
delete childEnv.OT_CHILD_BUN_OPTIONS;
delete childEnv.OT_CHILD_NODE_OPTIONS;
delete childEnv.OT_HOST_CONFIG_PATH;
const childCwd = childEnv.OT_CHILD_CWD;
delete childEnv.OT_CHILD_CWD;
const child = Bun.spawn(process.argv.slice(1), {
  cwd: childCwd,
  detached: true,
  env: childEnv,
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
});
const childResult = child.exited.then(exitCode => ({ kind: "child", exitCode }));
const ownerResult = Bun.stdin.text().then(command => ({ kind: "owner", command }));
const result = await Promise.race([childResult, ownerResult]);
if (result.kind === "owner" && result.command.trim() === "graceful") {
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  await Bun.sleep(250);
}
try { process.kill(-child.pid, "SIGKILL"); } catch {}
process.exit(result.kind === "child" ? result.exitCode : 1);
`;

type ActiveTask = {
	readonly exited: Promise<number>;
	requestStop(graceful: boolean): void;
};

export class PosixProcessOwner implements ProcessOwner {
	readonly kind = "posix" as const;
	private readonly inherited =
		hasInheritedProcessContainment() || process.env[OWNER_MARKER] === "1";
	private readonly tasks = new Set<ActiveTask>();
	private stopping = false;

	async spawn(
		command: readonly string[],
		options: OwnedSpawnOptions = {},
	): Promise<OwnedProcess> {
		if (this.stopping) throw new Error("POSIX process owner is stopping");
		if (this.inherited) return this.spawnInherited(command, options);

		const hostConfigPath = join(
			tmpdir(),
			`ot-process-owner-${process.pid}-${crypto.randomUUID()}.toml`,
		);
		await Bun.write(hostConfigPath, "");
		const desiredEnv = { ...process.env, ...options.env };
		const hostEnv = {
			...desiredEnv,
			[OWNER_MARKER]: "1",
			OT_CHILD_BUN_OPTIONS: desiredEnv.BUN_OPTIONS,
			OT_CHILD_CWD: options.cwd ?? process.cwd(),
			OT_CHILD_NODE_OPTIONS: desiredEnv.NODE_OPTIONS,
			OT_HOST_CONFIG_PATH: hostConfigPath,
		};
		delete hostEnv.BUN_OPTIONS;
		delete hostEnv.NODE_OPTIONS;

		const proc = Bun.spawn(
			[
				Bun.which("bun") ?? "bun",
				`--config=${hostConfigPath}`,
				"-e",
				POSIX_HOST,
				"--",
				...command,
			],
			{
				cwd: tmpdir(),
				detached: true,
				env: hostEnv,
				stderr: "pipe",
				stdin: "pipe",
				stdout: "pipe",
			},
		);

		let stopRequested = false;
		const task: ActiveTask = {
			exited: proc.exited,
			requestStop: (graceful) => {
				if (stopRequested) return;
				stopRequested = true;
				if (graceful) proc.stdin.write("graceful");
				proc.stdin.end();
			},
		};
		this.tasks.add(task);

		return {
			exited: proc.exited.finally(() => {
				this.tasks.delete(task);
				void rm(hostConfigPath, { force: true });
			}),
			stderr: proc.stderr,
			stdout: proc.stdout,
			terminate: () => task.requestStop(false),
		};
	}

	private async spawnInherited(
		command: readonly string[],
		options: OwnedSpawnOptions,
	): Promise<OwnedProcess> {
		const proc = Bun.spawn([...command], {
			cwd: options.cwd,
			env: {
				...inheritProcessContainment({ ...process.env, ...options.env }),
				[OWNER_MARKER]: "1",
			},
			stderr: "pipe",
			stdin: "ignore",
			stdout: "pipe",
		});
		return {
			exited: proc.exited,
			stderr: proc.stderr,
			stdout: proc.stdout,
			terminate: () => {
				try {
					proc.kill("SIGTERM");
				} catch {}
			},
		};
	}

	async shutdown(options: { readonly graceful?: boolean } = {}): Promise<void> {
		if (this.stopping) return;
		this.stopping = true;
		if (this.inherited) return;
		const tasks = [...this.tasks];
		for (const task of tasks) task.requestStop(options.graceful ?? false);
		await Promise.allSettled(tasks.map((task) => task.exited));
	}
}
