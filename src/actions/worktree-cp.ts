/**
 * Worktree copy action.
 */

import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WorktreeCpAction, WorktreeInfo } from "../types";
import { type ActionResult, withTiming } from "./types";

/**
 * Options for running a worktree copy action.
 */
export type WorktreeCpActionOptions = {
	readonly verbose: boolean;
	readonly gitRoot: string;
	readonly getWorktrees: () => Promise<readonly WorktreeInfo[]>;
};

/**
 * Copies files from another worktree to the current one.
 *
 * @param action - The worktree copy action configuration
 * @param options - Action options including git root and worktree resolver
 * @returns Action result with success, output, and duration
 */
export async function runWorktreeCpAction(
	action: WorktreeCpAction,
	options: WorktreeCpActionOptions,
): Promise<ActionResult> {
	return withTiming(async () => {
		const logs: string[] = [];
		const worktrees = await options.getWorktrees();

		// Support both "main" and "worktree:main" syntax for from field
		const fromBranch = action.from.startsWith("worktree:")
			? action.from.slice(9)
			: action.from;

		const sourceWorktree = worktrees.find((w) => w.branch === fromBranch);

		if (!sourceWorktree) {
			const available = worktrees.map((w) => w.branch).join(", ");
			throw new Error(
				`Worktree for branch "${fromBranch}" not found. Available: ${available}`,
			);
		}

		const sourcePath = sourceWorktree.path;
		let copied = 0;
		let skipped = 0;

		for (const pattern of action.files) {
			const glob = new Bun.Glob(pattern);
			const matches = await Array.fromAsync(
				glob.scan({ cwd: sourcePath, absolute: false }),
			);

			if (matches.length === 0) {
				if (action.allowMissing) {
					logs.push(`  Skipped (no match): ${pattern}`);
					skipped++;
					continue;
				}
				throw new Error(`No files matched pattern: ${pattern}`);
			}

			for (const match of matches) {
				const src = join(sourcePath, match);
				const dest = join(options.gitRoot, match);

				if (!existsSync(src)) {
					if (action.allowMissing) {
						logs.push(`  Skipped (missing): ${match}`);
						skipped++;
						continue;
					}
					throw new Error(`Source file not found: ${src}`);
				}

				const destDir = dirname(dest);
				if (!existsSync(destDir)) {
					mkdirSync(destDir, { recursive: true });
				}

				const srcStat = statSync(src);
				cpSync(src, dest, { recursive: srcStat.isDirectory() });
				logs.push(`  Copied: ${match}`);
				copied++;
			}
		}

		logs.unshift(
			`worktree:cp from ${action.from}: ${copied} copied, ${skipped} skipped`,
		);

		const output = logs.join("\n");

		if (options.verbose) {
			console.log(output);
		}

		return { success: true, output };
	});
}
