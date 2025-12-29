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
				if ("type" in hook && hook.type === "copy") {
					await this.runCopyHook(hook, worktreePath);
				} else if ("cmd" in hook) {
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
		hook: { cmd: string },
		worktreePath: string,
	): Promise<void> {
		console.log(`  Running: ${hook.cmd}`);
		// Run command inside the new worktree
		// Note: worktreePath is absolute
		// Use sh -c to support shell operators like redirects
		await $`sh -c ${hook.cmd}`.cwd(worktreePath);
	}

	/**
	 * Parses a path spec in the format `branch@path` or just `path`.
	 * If no branch is specified, returns `undefined` for the branch.
	 */
	private parsePathSpec(spec: string): {
		branch: string | undefined;
		path: string;
	} {
		const atIndex = spec.indexOf("@");
		if (atIndex === -1) {
			return { branch: undefined, path: spec };
		}
		return {
			branch: spec.slice(0, atIndex),
			path: spec.slice(atIndex + 1),
		};
	}

	/**
	 * Resolves a path relative to the given worktree root, ensuring it doesn't
	 * escape the worktree (path traversal prevention).
	 */
	private resolveSafePath(
		worktreeRoot: string,
		relativePath: string,
		cwd: string,
	): string {
		// Compute the relative directory from gitRoot to cwd
		let relativeDir = "";
		if (cwd.startsWith(this.gitRoot)) {
			relativeDir = cwd.slice(this.gitRoot.length);
			if (relativeDir.startsWith("/")) relativeDir = relativeDir.slice(1);
		}

		// Create full path: worktreeRoot + relativeDir + relativePath
		const fullPath = resolve(worktreeRoot, relativeDir, relativePath);

		// Ensure the resolved path is within the worktree root
		if (!fullPath.startsWith(`${worktreeRoot}/`) && fullPath !== worktreeRoot) {
			throw new Error(
				`Path traversal detected: ${relativePath} resolves outside worktree`,
			);
		}

		return fullPath;
	}

	/**
	 * Gets the root path for a given branch's worktree.
	 */
	private async getWorktreeRoot(branch: string | undefined): Promise<string> {
		if (!branch) {
			// No branch specified, use current worktree (git root of cwd)
			return this.gitRoot;
		}

		const worktrees = await GitUtil.getWorktrees({ cwd: this.gitRoot });
		const wt = worktrees.find((w) => w.branch === branch);

		if (!wt) {
			throw new Error(`No worktree found for branch: ${branch}`);
		}

		return wt.path;
	}

	/**
	 * Copies files between worktrees.
	 *
	 * @param src - Source path spec in the format `branch@path` or just `path`
	 * @param dest - Destination path spec in the format `branch@path` or just `path`
	 * @param cwd - Current working directory (for relative path resolution)
	 *
	 * @example
	 * // Copy from main to current worktree
	 * await manager.copy("main@./packages/**\/dist", ".", process.cwd());
	 *
	 * // Copy to main from current worktree
	 * await manager.copy(".env", "main@.env", process.cwd());
	 */
	async copy(src: string, dest: string, cwd: string): Promise<void> {
		const srcSpec = this.parsePathSpec(src);
		const destSpec = this.parsePathSpec(dest);

		const srcRoot = await this.getWorktreeRoot(srcSpec.branch);
		const destRoot = await this.getWorktreeRoot(destSpec.branch);

		// Check for globs in source path
		const hasGlob = srcSpec.path.includes("*");

		if (hasGlob) {
			// Use Bun.Glob for glob matching
			const glob = new Bun.Glob(srcSpec.path);
			const srcBasePath = this.resolveSafePath(srcRoot, "", cwd);
			const matches = glob.scanSync({ cwd: srcBasePath, absolute: true });

			let count = 0;
			for (const match of matches) {
				// Compute relative path from srcRoot
				const relPath = match.slice(srcBasePath.length + 1);
				const destPath = this.resolveSafePath(
					destRoot,
					join(destSpec.path, relPath),
					cwd,
				);

				// Ensure destination directory exists
				const destDir = destPath.substring(0, destPath.lastIndexOf("/"));
				if (!existsSync(destDir)) {
					mkdirSync(destDir, { recursive: true });
				}

				await $`cp -r ${match} ${destPath}`.quiet();
				count++;
			}

			if (count === 0) {
				console.warn(`Warning: No files matched pattern: ${srcSpec.path}`);
			} else {
				console.log(`Copied ${count} file(s)`);
			}
		} else {
			// Single file/directory copy
			const srcPath = this.resolveSafePath(srcRoot, srcSpec.path, cwd);
			const destPath = this.resolveSafePath(destRoot, destSpec.path, cwd);

			if (!existsSync(srcPath)) {
				throw new Error(`Source path does not exist: ${srcPath}`);
			}

			// Ensure destination directory exists
			const destDir = destPath.substring(0, destPath.lastIndexOf("/"));
			if (!existsSync(destDir)) {
				mkdirSync(destDir, { recursive: true });
			}

			await $`cp -r ${srcPath} ${destPath}`.quiet();
			console.log(`Copied ${srcSpec.path} -> ${destSpec.path}`);
		}
	}
}
