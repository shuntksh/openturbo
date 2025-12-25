import { resolve } from "node:path";
import { $ } from "bun";
import type { WorktreeInfo } from "./types";

async function getGitRoot(): Promise<string> {
	const result = await $`git rev-parse --show-toplevel`.quiet().nothrow();
	if (result.exitCode !== 0) {
		throw new Error("Not in a git repository");
	}
	return result.text().trim();
}

async function getCurrentBranch(): Promise<string> {
	const result = await $`git branch --show-current`.quiet().nothrow();
	if (result.exitCode !== 0) {
		throw new Error("Failed to get current branch");
	}
	return result.text().trim();
}

async function getWorktrees(): Promise<readonly WorktreeInfo[]> {
	const result = await $`git worktree list --porcelain`.quiet().nothrow();
	if (result.exitCode !== 0) {
		return [];
	}

	const output = result.text().trim();
	if (!output) {
		return [];
	}

	const chunks = output.split("\n\n");
	const worktrees: WorktreeInfo[] = [];

	for (const chunk of chunks) {
		if (!chunk) continue; // Skip empty chunks from trailing newlines

		let path: string | undefined;
		let branch: string | undefined;

		for (const line of chunk.split("\n")) {
			if (line.startsWith("worktree ")) {
				path = line.slice(9);
			} else if (line.startsWith("branch refs/heads/")) {
				branch = line.slice(18);
			}
		}

		if (path && branch) {
			worktrees.push({
				path,
				branch,
				isMain: worktrees.length === 0, // First worktree is main
			});
		}
	}

	return worktrees;
}

async function isInWorktree(gitRoot: string): Promise<boolean> {
	const worktrees = await getWorktrees();
	const mainWorktree = worktrees.find((w) => w.isMain);
	return mainWorktree ? resolve(gitRoot) !== resolve(mainWorktree.path) : false;
}

export const GitUtil = {
	getGitRoot,
	getCurrentBranch,
	getWorktrees,
	isInWorktree,
} as const;
