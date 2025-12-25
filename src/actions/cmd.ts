/**
 * Command execution action.
 */

import { $ } from "bun";
import { type ActionResult, withTiming } from "./types";

/**
 * Options for running a command action.
 */
export type CmdActionOptions = {
	readonly verbose: boolean;
};

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
		const result = await $`${{ raw: cmd }}`.quiet().nothrow();
		const output = result.text();
		const success = result.exitCode === 0;

		if (options.verbose && output.trim()) {
			console.log(output);
		}

		return { success, output };
	});
}
