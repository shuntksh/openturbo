import { parseArgs } from "node:util";
import { GitUtil } from "../git-util";
import { WorktreeManager } from "../worktree";
import type { Config, ColorFn } from "../types";

export async function handleWt(
	args: string[],
	config: Config,
	c: ColorFn,
): Promise<void> {
	const subcommand = args[0];
	const restArgs = args.slice(1);

	const gitRoot = await GitUtil.getGitRoot();
	const manager = new WorktreeManager(gitRoot, config);

	switch (subcommand) {
		case "ls":
		case "list":
			await handleList(manager, c);
			break;
		case "add":
			await handleAdd(manager, restArgs, c);
			break;
		case "rm":
		case "remove":
			await handleRemove(manager, restArgs, c);
			break;
		default:
			console.error(c("red", `Unknown subcommand: ${subcommand}`));
			console.error(c("dim", "Available: add, remove (rm), list (ls)"));
			process.exit(1);
	}
}

async function handleList(manager: WorktreeManager, c: ColorFn): Promise<void> {
	const worktrees = await manager.list();

	console.log(
		c("bold", "PATH").padEnd(40) +
			c("bold", "BRANCH").padEnd(30) +
			c("bold", "HEAD"),
	);
	console.log(c("dim", "─".repeat(80)));

	for (const wt of worktrees) {
		const isMainMarker = wt.isMain ? c("cyan", " (main)") : "";
		const path = wt.path.replace(process.env.HOME ?? "", "~");
		console.log(
			path.padEnd(40) +
				(wt.branch + isMainMarker).padEnd(40) + // Adjust padding for color codes
				c("dim", wt.head),
		);
	}
}

async function handleAdd(
	manager: WorktreeManager,
	args: string[],
	c: ColorFn,
): Promise<void> {
	const { positionals, values } = parseArgs({
		args,
		options: {
			branch: { short: "b", type: "string" },
			base: { type: "string" }, // Base commit/tag
			force: { short: "f", type: "boolean" },
		},
		allowPositionals: true,
	});

	const branch = values.branch ?? positionals[0];

	if (!branch) {
		console.error(c("red", "Error: Branch name is required"));
		console.error(c("dim", "Usage: wt add [-b] <branch> [--base <commit>]"));
		process.exit(1);
	}

	try {
		await manager.add(branch, {
			// Refined logic:
			// `wt add -b foo`: create NEW branch foo
			// `wt add foo`: checkout EXISTING branch foo

			newBranch: !!values.branch,
			base: values.base,
			force: values.force,
		});
		console.log(c("green", `Worktree added for ${branch}`));
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(c("red", `Error: ${message}`));
		process.exit(1);
	}
}

async function handleRemove(
	manager: WorktreeManager,
	args: string[],
	c: ColorFn,
): Promise<void> {
	const { positionals, values } = parseArgs({
		args,
		options: {
			force: { short: "f", type: "boolean" },
			"with-branch": { type: "boolean" },
		},
		allowPositionals: true,
	});

	const branch = positionals[0];

	if (!branch) {
		console.error(c("red", "Error: Branch or path is required"));
		process.exit(1);
	}

	try {
		await manager.remove(branch, {
			force: values.force,
			deleteBranch: values["with-branch"],
		});
		console.log(c("green", `Worktree removed for ${branch}`));
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(c("red", `Error: ${message}`));
		process.exit(1);
	}
}
