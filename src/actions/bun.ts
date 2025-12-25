/**
 * Bun workspace action for turborepo-style parallel script execution.
 */

import { $ } from "bun";
import {
	buildDependencyGraph,
	discoverWorkspaces,
	resolveTaskDependencies,
	type TaskNode,
	topologicalSort,
} from "../npm-workspace";
import type { NestedTask, ProgressPrinter } from "../progress-printer";
import type { BunAction } from "../types";
import { type ActionResult, withTiming } from "./types";

/**
 * Options for running a bun action.
 */
export type BunActionOptions = {
	readonly verbose: boolean;
	readonly gitRoot: string;
	/** Step name (for printer updates) */
	readonly stepName?: string;
	/** Optional progress printer for nested task display */
	readonly printer?: ProgressPrinter;
};

/**
 * Result for a single task execution including package context.
 */
export type TaskResult = ActionResult & {
	readonly packageName: string;
	readonly script: string;
};

/**
 * Runs a single script in a package with optional timeout.
 */
async function runPackageScript(
	node: TaskNode,
	timeout: number | undefined,
	verbose: boolean,
): Promise<TaskResult> {
	const start = performance.now();

	const runScript = async (): Promise<TaskResult> => {
		const result = await $`bun run ${node.script}`
			.cwd(node.packagePath)
			.quiet()
			.nothrow();

		const output = result.text();
		const success = result.exitCode === 0;
		const duration = Math.round(performance.now() - start);

		if (verbose && output.trim()) {
			console.log(`[${node.packageName}] ${output}`);
		}

		return {
			success,
			output,
			duration,
			packageName: node.packageName,
			script: node.script,
		};
	};

	try {
		if (timeout !== undefined && timeout > 0) {
			const timeoutPromise = new Promise<TaskResult>((_, reject) => {
				setTimeout(
					() => reject(new Error(`Timeout after ${timeout}ms`)),
					timeout,
				);
			});
			return await Promise.race([runScript(), timeoutPromise]);
		}
		return await runScript();
	} catch (e) {
		const duration = Math.round(performance.now() - start);
		const message = e instanceof Error ? e.message : String(e);

		return {
			success: false,
			output: message,
			duration,
			packageName: node.packageName,
			script: node.script,
		};
	}
}

/**
 * Runs bun scripts across workspace with dependency ordering.
 *
 * @param action - The bun action configuration
 * @param options - Execution options
 * @returns Aggregated action result
 */
export async function runBunAction(
	action: BunAction,
	options: BunActionOptions,
): Promise<ActionResult> {
	return withTiming(async () => {
		const { printer, stepName } = options;
		const logs: string[] = [];

		// Discover workspace packages
		const packages = await discoverWorkspaces(options.gitRoot);

		if (packages.length === 0) {
			return {
				success: true,
				output: "No workspace packages found",
			};
		}

		// Filter to packages that have the script
		const packagesWithScript = packages.filter(
			(p) => action.script in p.scripts,
		);

		if (packagesWithScript.length === 0) {
			return {
				success: true,
				output: `No packages have script "${action.script}"`,
			};
		}

		// Build dependency graph
		const dependencyGraph = buildDependencyGraph(packages);

		// Resolve task dependencies
		const allNodes = resolveTaskDependencies(
			action.script,
			action.dependsOn ?? [],
			packages,
			dependencyGraph,
		);

		// Topologically sort for execution order
		const layers = topologicalSort(allNodes);

		// Set up nested tasks in printer if available
		if (printer && stepName) {
			const nestedTasks: NestedTask[] = allNodes.map((node) => ({
				id: `${node.packageName}#${node.script}`,
				status: "pending" as const,
			}));
			printer.setNested(stepName, nestedTasks);
		}

		let totalSuccess = true;
		const results: TaskResult[] = [];

		// Execute layer by layer (parallel within each layer)
		for (const layer of layers) {
			if (!layer || layer.length === 0) continue;

			// Mark as running in printer
			if (printer && stepName) {
				for (const node of layer) {
					printer.updateNested(stepName, `${node.packageName}#${node.script}`, {
						status: "running",
					});
				}
			}

			// Run all tasks in this layer in parallel
			const layerPromises = layer.map(async (node) => {
				const result = await runPackageScript(
					node,
					action.timeout,
					options.verbose,
				);

				// Update printer with result
				if (printer && stepName) {
					printer.updateNested(stepName, `${node.packageName}#${node.script}`, {
						status: result.success ? "done" : "failed",
						duration: result.duration,
					});
				}

				return result;
			});

			const layerResults = await Promise.all(layerPromises);

			for (const result of layerResults) {
				results.push(result);

				const status = result.success ? "✓" : "✗";
				const duration = `${result.duration}ms`;
				logs.push(
					`  ${status} ${result.packageName}#${result.script} (${duration})`,
				);

				if (!result.success) {
					totalSuccess = false;
					logs.push(`    Error: ${result.output.split("\n")[0]}`);
				}
			}

			// If any task in this layer failed, skip remaining layers
			if (!totalSuccess) {
				break;
			}
		}

		const passed = results.filter((r) => r.success).length;
		const failed = results.filter((r) => !r.success).length;

		return {
			success: totalSuccess,
			output: totalSuccess
				? `${passed} packages passed`
				: `${logs.join("\n")}\n\nCompleted: ${passed} passed, ${failed} failed`,
		};
	});
}
