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
import { z } from "zod";
import { handleGraph, handleHelp, handleRun, handleWt } from "./handlers/mod";
import {
	ConfigSchema,
	createColorizer,
	GitUtil,
	getSteps,
	loadConfig,
} from "./mod";

async function main(): Promise<void> {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		strict: false,
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

	const configArg = values.config as string | undefined;
	const jobArg = values.job as string | undefined;
	const verboseArg = values.verbose as boolean | undefined;
	const failFastArg = values["fail-fast"] as boolean | undefined;

	const isTTY = process.stdout.isTTY ?? false;
	const noColor = values["no-color"] ?? !isTTY;
	const c = createColorizer(!noColor);

	// Handle --help
	if (values.help) {
		try {
			const gitRoot = await GitUtil.getGitRoot();
			const config = await loadConfig(configArg, gitRoot);
			handleHelp(config, c);
		} catch {
			handleHelp(null, c);
		}
		process.exit(0);
	}

	// Handle wt command
	if (jobArg === "wt" || positionals[0] === "wt") {
		const gitRoot = await GitUtil.getGitRoot();
		const config = await loadConfig(configArg, gitRoot);

		// Pass raw arguments after "wt" to preserve flags like -b
		const rawArgs = Bun.argv.slice(2);
		const wtIndex = rawArgs.indexOf("wt");
		// If wt is not found in rawArgs (passed via --job=wt maybe?), fallback to positionals but that might launch flawed args
		// But mostly it will be found.
		const args = wtIndex !== -1 ? rawArgs.slice(wtIndex + 1) : [];

		await handleWt(args, config, c);
		process.exit(0);
	}

	// Handle schema command
	if (positionals[0] === "schema") {
		const jsonSchema = z.toJSONSchema(ConfigSchema);
		console.log(JSON.stringify(jsonSchema, null, 2));
		process.exit(0);
	}

	// Require job name
	const jobName = jobArg ?? positionals[0];
	if (!jobName) {
		console.error(
			c(
				"red",
				"Error: Job name is required (use --job <name> or positional argument)",
			),
		);
		console.error(c("dim", "Run with --help for usage information"));
		process.exit(1);
	}

	// Handle --graph
	if (values.graph) {
		const gitRoot = await GitUtil.getGitRoot();
		const config = await loadConfig(configArg, gitRoot);
		const workflow = config.workflows[jobName];

		if (!workflow) {
			const available = Object.keys(config.workflows).join(", ");
			console.error(c("red", `Error: Job "${jobName}" not found`));
			console.error(c("dim", `Available jobs: ${available}`));
			process.exit(1);
		}

		const steps = getSteps(workflow);
		try {
			await handleGraph(steps, c, gitRoot);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.error(c("red", `Error: ${message}`));
			process.exit(1);
		}
		process.exit(0);
	}

	// Default: run the job
	const exitCode = await handleRun({
		jobName,
		configPath: configArg,
		verbose: verboseArg ?? false,
		failFast: failFastArg ?? true,
		isTTY,
		c,
	});

	process.exit(exitCode);
}

main();
