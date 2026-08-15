import { spawnOwned } from "./process-owner/scope";
import type { OwnedProcess, OwnedSpawnOptions } from "./process-owner/types";

export type ProcessTree = OwnedProcess;

export type ProcessTreeResult = {
	readonly exitCode: number;
	readonly stderr: string;
	readonly stdout: string;
};

/** Compatibility facade for the repository-wide process owner. */
export async function spawnProcessTree(
	command: readonly string[],
	options: OwnedSpawnOptions = {},
): Promise<ProcessTree> {
	return spawnOwned(command, options);
}

/** Runs an owned process tree and captures its complete output. */
export async function runProcessTree(
	command: readonly string[],
	options: OwnedSpawnOptions = {},
): Promise<ProcessTreeResult> {
	const proc = await spawnOwned(command, options);
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stderr, stdout };
}

export { withProcessOwner } from "./process-owner/scope";
