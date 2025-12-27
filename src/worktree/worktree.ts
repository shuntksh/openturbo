import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { GitUtil } from "../mod";
import type { Config, WorktreeHook } from "../types";

/**
 * Worktree manager for creating and managing git worktrees.
 */
export class WorktreeManager {
	private readonly gitRoot: string;
	private readonly config: Config;
	private readonly baseDir: string;

	constructor(gitRoot: string, config: Config) {
		this.gitRoot = gitRoot;
		this.config = config;
		this.baseDir = resolve(
			gitRoot,
			config.worktree?.defaults?.base_dir ?? "../worktrees",
		);
	}

	/**
	 * Lists all managed worktrees.
	 */
	async list(): Promise<
		{ path: string; branch: string; isMain: boolean; head: string }[]
	> {
		const worktrees = await GitUtil.getWorktrees({ cwd: this.gitRoot });
		const results = [];

		for (const wt of worktrees) {
			const head = await this.getHead(wt.path);
			results.push({ ...wt, head });
		}

		return results;
	}

	/**
	 * Adds a new worktree.
	 */
	async add(
		branch: string,
		options: {
			newBranch?: boolean;
			force?: boolean;
			base?: string;
		} = {},
	): Promise<void> {
		const worktreePath = join(this.baseDir, branch);

		// Ensure base directory exists
		if (!existsSync(this.baseDir)) {
			mkdirSync(this.baseDir, { recursive: true });
		}

		if (existsSync(worktreePath) && !options.force) {
			throw new Error(`Worktree directory already exists: ${worktreePath}`);
		}

		const cmd = ["git", "worktree", "add"];
		if (options.force) cmd.push("--force");

		if (options.newBranch) {
			cmd.push("-b", branch, worktreePath, options.base ?? "HEAD");
		} else {
			cmd.push(worktreePath, branch);
		}

		console.log(`Creating worktree for ${branch} at ${worktreePath}...`);
		const result = await $`${cmd}`.cwd(this.gitRoot).quiet().nothrow();

		if (result.exitCode !== 0) {
			throw new Error(`Failed to create worktree: ${result.stderr.toString()}`);
		}

		await this.runHooks(worktreePath);
	}

	/**
	 * Removes a worktree.
	 */
	async remove(
		branch: string,
		options: {
			force?: boolean;
			deleteBranch?: boolean;
		} = {},
	): Promise<void> {
		const worktrees = await GitUtil.getWorktrees({ cwd: this.gitRoot });
		const wt = worktrees.find(
			(w) => w.branch === branch || w.path.endsWith(branch),
		);

		if (!wt) {
			throw new Error(`Worktree not found for branch: ${branch}`);
		}

		if (wt.isMain) {
			throw new Error("Cannot remove main worktree");
		}

		const cmd = ["git", "worktree", "remove"];
		if (options.force) cmd.push("--force");
		cmd.push(wt.path);

		console.log(`Removing worktree at ${wt.path}...`);
		const result = await $`${cmd}`.cwd(this.gitRoot).quiet().nothrow();

		if (result.exitCode !== 0) {
			throw new Error(`Failed to remove worktree: ${result.stderr.toString()}`);
		}

		if (options.deleteBranch) {
			const deleteCmd = ["git", "branch", "-D", branch]; // -D forces delete
			console.log(`Deleting branch ${branch}...`);
			const deleteResult = await $`${deleteCmd}`
				.cwd(this.gitRoot)
				.quiet()
				.nothrow();
			if (deleteResult.exitCode !== 0) {
				console.warn(
					`Warning: Failed to delete branch ${branch}: ${deleteResult.stderr.toString()}`,
				);
			}
		}
	}

	private async getHead(path: string): Promise<string> {
		try {
			const result = await $`git -C ${path} rev-parse --short HEAD`
				.quiet()
				.text();
			return result.trim();
		} catch {
			return "unknown";
		}
	}

	private async runHooks(worktreePath: string): Promise<void> {
		const hooks = this.config.worktree?.hooks?.post_create;
		if (!hooks || hooks.length === 0) return;

		console.log("Running post-create hooks...");
		for (const hook of hooks) {
			try {
				if (hook.type === "copy") {
					await this.runCopyHook(hook, worktreePath);
				} else if (hook.type === "command") {
					await this.runCommandHook(hook, worktreePath);
				}
			} catch (e) {
				console.error(`Hook failed: ${e}`);
			}
		}
	}

	private async runCopyHook(
		hook: Extract<WorktreeHook, { type: "copy" }>,
		worktreePath: string,
	): Promise<void> {
		const src = resolve(this.gitRoot, hook.from);
		const dest = resolve(worktreePath, hook.to);

		console.log(`  Copying ${hook.from} -> ${hook.to}`);
		await $`cp -r ${src} ${dest}`.cwd(this.gitRoot);
	}

	private async runCommandHook(
		hook: Extract<WorktreeHook, { type: "command" }>,
		worktreePath: string,
	): Promise<void> {
		console.log(`  Running: ${hook.command}`);
		// Run command inside the new worktree
		// Note: worktreePath is absolute
		// Use sh -c to support shell operators like redirects
		await $`sh -c ${hook.command}`.cwd(worktreePath);
	}
}
