/**
 * Command execution action.
 */

import { appendShellArgs, createChangedFilesEnv } from "../changed-files";
import { spawnProcessTree } from "../process-tree";
import { buildShellCommand, resolveShell, shellScriptHint } from "../shell";
import { type ActionResult, withTiming } from "./types";

/**
 * Options for running a command action.
 */
export type CmdActionOptions = {
	readonly verbose: boolean;
	readonly appendChangedFiles?: boolean;
	readonly changedFiles?: readonly string[];
	readonly changedFilesSpecified?: boolean;
};

async function readPipe(
	stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
	if (!stream) return "";

	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let output = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		output += decoder.decode(value, { stream: true });
	}

	output += decoder.decode();
	return output;
}

/**
 * Runs a shell command and returns the result.
 *
 * @param cmd - The command string to execute
 * @param options - Action options
 * @returns Action result with success, output, and duration
 */
export async function runCmdAction(
	cmd: string,
	options: CmdActionOptions,
): Promise<ActionResult> {
	return withTiming(async () => {
		const shell = resolveShell();
		const changedFiles = options.changedFiles ?? [];
		const changedFileArgEnv =
			shell.kind === "cmd"
				? Object.fromEntries(
						changedFiles.map((file, index) => [
							`OT_CHANGED_FILE_ARG_${index}`,
							file,
						]),
					)
				: {};
		if (options.appendChangedFiles && options.changedFilesSpecified) {
			if (changedFiles.length === 0) {
				return {
					success: true,
					output: "No changed files",
				};
			}
		}
		if (options.appendChangedFiles && shell.kind === "cmd") {
			const invalidFile = changedFiles.find((file) => /[\0"<>|?*]/.test(file));
			if (invalidFile !== undefined) {
				return {
					success: false,
					output:
						`Cannot append changed file ${JSON.stringify(invalidFile)} through cmd.exe: ` +
						"the path contains a character forbidden in Windows filenames.",
				};
			}
		}

		const command =
			options.appendChangedFiles && changedFiles.length > 0
				? shell.kind === "cmd"
					? `${cmd.trimEnd()} ${changedFiles
							.map((_, index) => `"%OT_CHANGED_FILE_ARG_${index}%"`)
							.join(" ")}`
					: appendShellArgs(cmd, changedFiles, shell.kind)
				: cmd;

		const proc = await spawnProcessTree(buildShellCommand(shell, command), {
			env: {
				...process.env,
				...createChangedFilesEnv(changedFiles),
				...changedFileArgEnv,
			},
			windowsVerbatimArguments: shell.kind === "cmd",
		});

		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			readPipe(proc.stdout),
			readPipe(proc.stderr),
		]);
		let output = stdout + (stderr ? (stdout ? "\n" : "") + stderr : "");
		const success = exitCode === 0;
		if (!success) output += shellScriptHint(command, shell);

		if (options.verbose && output.trim()) {
			console.log(output);
		}

		return { success, output };
	});
}
