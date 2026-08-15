import { resolve } from "node:path";
import { runProcessTree } from "./process-tree";
import type { WorktreeInfo } from "./types";

type GitOptions = {
	readonly cwd?: string;
};

async function getGitRoot(options: GitOptions = {}): Promise<string> {
	const result = await runProcessTree(["git", "rev-parse", "--show-toplevel"], {
		cwd: options.cwd,
	});
	if (result.exitCode !== 0) {
		throw new Error("Not in a git repository");
	}
	return result.stdout.trim();
}

async function getCurrentBranch(options: GitOptions = {}): Promise<string> {
	const result = await runProcessTree(["git", "branch", "--show-current"], {
		cwd: options.cwd,
	});
	if (result.exitCode !== 0) {
		throw new Error("Failed to get current branch");
	}
	return result.stdout.trim();
}

async function getWorktrees(
	options: GitOptions = {},
): Promise<readonly WorktreeInfo[]> {
	const result = await runProcessTree(
		["git", "worktree", "list", "--porcelain"],
		{ cwd: options.cwd },
	);
	if (result.exitCode !== 0) {
		return [];
	}

	const output = result.stdout.trim();
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

async function isInWorktree(
	gitRoot: string,
	options: GitOptions = {},
): Promise<boolean> {
	const worktrees = await getWorktrees(options);
	const mainWorktree = worktrees.find((w) => w.isMain);
	return mainWorktree ? resolve(gitRoot) !== resolve(mainWorktree.path) : false;
}

export const GitUtil = {
	getGitRoot,
	getCurrentBranch,
	getWorktrees,
	isInWorktree,
} as const;
