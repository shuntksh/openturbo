import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	mkdtempSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { WorktreeManager } from "./worktree";
import type { Config } from "../types";

// Helper to create a temp directory
function createTempDir(): string {
	return mkdtempSync(join(tmpdir(), "wtp-test-"));
}

describe("WorktreeManager", () => {
	let tmpDir: string;
	let gitRoot: string;

	beforeAll(async () => {
		// Setup temp directory
		tmpDir = createTempDir();
		// Resolve physical path to match realpath behavior (like the fish test)
		tmpDir = await $`realpath ${tmpDir}`.text().then((t) => t.trim());

		gitRoot = join(tmpDir, "repo");
		mkdirSync(gitRoot);

		// Initialize git repo
		await $`git init -q`.cwd(gitRoot);
		await $`git config user.email "ci@wtp.fish"`.cwd(gitRoot);
		await $`git config user.name "CI"`.cwd(gitRoot);
		await $`git commit --allow-empty -m "root" -q`.cwd(gitRoot);
	});

	afterAll(() => {
		// Cleanup
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("add worktree creates directory", async () => {
		const config: Config = {
			workflows: {},
			worktree: {
				defaults: {
					base_dir: "wts", // Relative to git root
				},
			},
		};

		const manager = new WorktreeManager(gitRoot, config);
		await manager.add("feat-1", { newBranch: true });

		const worktreePath = join(gitRoot, "wts", "feat-1");
		expect(existsSync(worktreePath)).toBe(true);

		const list = await manager.list();
		const created = list.find((w) => w.branch === "feat-1");
		expect(created).toBeDefined();
		expect(created?.path).toBe(worktreePath);
	});

	test("add nested worktree", async () => {
		const config: Config = {
			workflows: {},
			worktree: {
				defaults: {
					base_dir: "nested/path",
				},
			},
		};

		const manager = new WorktreeManager(gitRoot, config);
		await manager.add("feat-nested", { newBranch: true });

		const worktreePath = join(gitRoot, "nested", "path", "feat-nested");
		expect(existsSync(worktreePath)).toBe(true);
	});

	test("hooks: copy and command", async () => {
		// Create dummy file
		await $`echo "secret data" > .env.example`.cwd(gitRoot);

		const config: Config = {
			workflows: {},
			worktree: {
				defaults: {
					base_dir: "wts",
				},
				hooks: {
					post_create: [
						{ type: "copy", from: ".env.example", to: ".env" },
						{ cmd: "echo 'hook ran' > hooks_ran.txt" },
					],
				},
			},
		};

		const manager = new WorktreeManager(gitRoot, config);
		await manager.add("hook-feature", { newBranch: true });

		const worktreePath = join(gitRoot, "wts", "hook-feature");
		expect(existsSync(join(worktreePath, ".env"))).toBe(true);
		expect(readFileSync(join(worktreePath, ".env"), "utf-8").trim()).toBe(
			"secret data",
		);
		expect(existsSync(join(worktreePath, "hooks_ran.txt"))).toBe(true);
		expect(
			readFileSync(join(worktreePath, "hooks_ran.txt"), "utf-8").trim(),
		).toBe("hook ran");
	});

	test("remove managed worktree", async () => {
		const config: Config = {
			workflows: {},
			worktree: {
				defaults: {
					base_dir: "wts",
				},
			},
		};

		const manager = new WorktreeManager(gitRoot, config);
		// Reuse hook-feature from previous test
		await manager.remove("hook-feature", { force: true }); // Force removal because it's dirty? Tests run fast.

		const worktreePath = join(gitRoot, "wts", "hook-feature");
		expect(existsSync(worktreePath)).toBe(false);
	});

	test("remove unmanaged worktree", async () => {
		const config: Config = { workflows: {} };
		const manager = new WorktreeManager(gitRoot, config);

		// Create unmanaged worktree
		const unmanagedPath = join(gitRoot, "unmanaged-wt");
		await $`git worktree add -b unmanaged-test ${unmanagedPath}`.cwd(gitRoot);

		expect(existsSync(unmanagedPath)).toBe(true);

		await manager.remove("unmanaged-test", { force: true });
		expect(existsSync(unmanagedPath)).toBe(false);
	});

	test("copy file from worktree to main", async () => {
		const config: Config = {
			workflows: {},
			worktree: {
				defaults: {
					base_dir: "wts",
				},
			},
		};

		const manager = new WorktreeManager(gitRoot, config);

		// Create worktree and file in it
		await manager.add("copy-source", { newBranch: true });
		const worktreePath = join(gitRoot, "wts", "copy-source");
		await $`echo "test content" > test-file.txt`.cwd(worktreePath);

		// Copy from worktree to main
		await manager.copy("copy-source@test-file.txt", "copied-file.txt", gitRoot);

		expect(existsSync(join(gitRoot, "copied-file.txt"))).toBe(true);
		expect(readFileSync(join(gitRoot, "copied-file.txt"), "utf-8").trim()).toBe(
			"test content",
		);

		// Cleanup
		await manager.remove("copy-source", { force: true });
	});

	test("copy file from main to worktree", async () => {
		const config: Config = {
			workflows: {},
			worktree: {
				defaults: {
					base_dir: "wts",
				},
			},
		};

		const manager = new WorktreeManager(gitRoot, config);

		// Create file in main
		await $`echo "main content" > main-file.txt`.cwd(gitRoot);

		// Create worktree
		await manager.add("copy-dest", { newBranch: true });
		const worktreePath = join(gitRoot, "wts", "copy-dest");

		// Copy from main to worktree
		await manager.copy("main-file.txt", "copy-dest@main-file.txt", gitRoot);

		expect(existsSync(join(worktreePath, "main-file.txt"))).toBe(true);
		expect(
			readFileSync(join(worktreePath, "main-file.txt"), "utf-8").trim(),
		).toBe("main content");

		// Cleanup
		await manager.remove("copy-dest", { force: true });
	});

	test("copy prevents path traversal", async () => {
		const config: Config = { workflows: {} };
		const manager = new WorktreeManager(gitRoot, config);

		// Attempt path traversal
		await expect(
			manager.copy("../../../etc/passwd", "passwd", gitRoot),
		).rejects.toThrow(/Path traversal detected/);
	});

	test("copy with glob pattern", async () => {
		const config: Config = {
			workflows: {},
			worktree: {
				defaults: {
					base_dir: "wts",
				},
			},
		};

		const manager = new WorktreeManager(gitRoot, config);

		// Create worktree with multiple files
		await manager.add("glob-source", { newBranch: true });
		const worktreePath = join(gitRoot, "wts", "glob-source");
		mkdirSync(join(worktreePath, "packages", "a"), { recursive: true });
		mkdirSync(join(worktreePath, "packages", "b"), { recursive: true });
		await $`echo "a content" > packages/a/file.txt`.cwd(worktreePath);
		await $`echo "b content" > packages/b/file.txt`.cwd(worktreePath);

		// Copy using glob
		mkdirSync(join(gitRoot, "dest-packages"), { recursive: true });
		await manager.copy(
			"glob-source@packages/**/file.txt",
			"dest-packages",
			gitRoot,
		);

		expect(
			existsSync(join(gitRoot, "dest-packages", "packages", "a", "file.txt")),
		).toBe(true);
		expect(
			existsSync(join(gitRoot, "dest-packages", "packages", "b", "file.txt")),
		).toBe(true);

		// Cleanup
		await manager.remove("glob-source", { force: true });
	});
});
