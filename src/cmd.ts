#!/usr/bin/env bun

/**
 * Generic job runner with Git worktree awareness.
 *
 * @example
 * ```sh
 * bun run .config/scripts/runner/cmd.ts preflight
 * bun run .config/scripts/runner/cmd.ts init-worktree --verbose
 * bun run .config/scripts/runner/cmd.ts --help
 * ```
 */

import { parseArgs } from "node:util";
import { handleGraph, handleHelp, handleRun, loadConfig } from "./handlers/mod";
import { createColorizer, GitUtil, getSteps } from "./mod";

async function main(): Promise<void> {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		args: Bun.argv.slice(2),
		options: {
			config: { short: "c", type: "string" },
			"fail-fast": { default: true, type: "boolean" },
			graph: { type: "boolean" },
			help: { short: "h", type: "boolean" },
			job: { short: "j", type: "string" },
			"no-color": { type: "boolean" },
			verbose: { short: "v", type: "boolean" },
		},
	});

	const isTTY = process.stdout.isTTY ?? false;
	const noColor = values["no-color"] ?? !isTTY;
	const c = createColorizer(!noColor);

	// Handle --help
	if (values.help) {
		try {
			const gitRoot = await GitUtil.getGitRoot();
			const config = await loadConfig(values.config, gitRoot);
			handleHelp(config, c);
		} catch {
			handleHelp(null, c);
		}
		process.exit(0);
	}

	// Require job name
	const jobName = values.job ?? positionals[0];
	if (!jobName) {
		console.error(c("red", "Error: --job <name> is required"));
		console.error(c("dim", "Run with --help for usage information"));
		process.exit(1);
	}

	// Handle --graph
	if (values.graph) {
		const gitRoot = await GitUtil.getGitRoot();
		const config = await loadConfig(values.config, gitRoot);
		const workflow = config.workflows[jobName];

		if (!workflow) {
			const available = Object.keys(config.workflows).join(", ");
			console.error(c("red", `Error: Job "${jobName}" not found`));
			console.error(c("dim", `Available jobs: ${available}`));
			process.exit(1);
		}

		const steps = getSteps(workflow);
		await handleGraph(steps, c, gitRoot);
		process.exit(0);
	}

	// Default: run the job
	const exitCode = await handleRun({
		jobName,
		configPath: values.config,
		verbose: values.verbose ?? false,
		failFast: values["fail-fast"] ?? true,
		isTTY,
		c,
	});

	process.exit(exitCode);
}

main();
