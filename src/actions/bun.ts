/**
 * Bun workspace action for turborepo-style parallel script execution.
 */

import {
	createChangedFilesEnv,
	scopeChangedFilesToDirectory,
} from "../changed-files";
import {
	buildDependencyGraph,
	discoverWorkspaces,
	resolveTaskDependencies,
	type TaskNode,
	topologicalSort,
} from "../npm-workspace";
import { spawnProcessTree } from "../process-tree";
import type { NestedTask, ProgressPrinter } from "../progress-printer";
import {
	checkTaskCache,
	normalizeBunCache,
	writeTaskCacheSuccess,
} from "../task-cache";
import type { BunAction } from "../types";
import { type ActionResult, withTiming } from "./types";

/**
 * Options for running a bun action.
 */
export type BunActionOptions = {
	readonly verbose: boolean;
	readonly gitRoot: string;
	readonly appendChangedFiles?: boolean;
	readonly changedFiles?: readonly string[];
	readonly changedFilesSpecified?: boolean;
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
	readonly cached?: boolean;
	readonly skipped?: boolean;
};

/**
 * Returns the hard timeout in milliseconds for a Bun action.
 */
function getHardTimeoutMs(action: BunAction): number | undefined {
	if (action.hardTimeoutSeconds !== undefined) {
		return Math.round(action.hardTimeoutSeconds * 1000);
	}
	return action.timeout;
}

function getParallelLimit(action: BunAction): number {
	const setting = action.parallel ?? action.pararell ?? true;
	if (setting === false) return 1;
	if (setting === true) return 5;
	if (setting === -1) return Number.POSITIVE_INFINITY;
	if (!Number.isFinite(setting) || setting < 1) return 1;
	return Math.floor(setting);
}

async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex++;
			const item = items[index];
			if (item === undefined) continue;
			results[index] = await fn(item);
		}
	}

	const workerCount = Math.min(limit, items.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}

function normalizeOutput(
	stdout: string,
	stderr: string,
	verbose: boolean,
): string {
	let output = stdout + (stderr ? (stdout ? "\n" : "") + stderr : "");

	if (!verbose) {
		output = output
			.split("\n")
			.filter((line) => !line.trim().startsWith("(pass)"))
			.join("\n");
	}

	return output;
}

/**
 * Runs a single script in a package with an optional hard timeout.
 */
async function runPackageScript(
	action: BunAction,
	node: TaskNode,
	scriptCommand: string,
	changedFiles: readonly string[],
	gitRoot: string,
	hardTimeoutMs: number | undefined,
	verbose: boolean,
	options: Pick<
		BunActionOptions,
		"appendChangedFiles" | "changedFilesSpecified"
	>,
): Promise<TaskResult> {
	const start = performance.now();
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;

	try {
		if (options.appendChangedFiles && options.changedFilesSpecified) {
			if (changedFiles.length === 0) {
				return {
					success: true,
					output: "No changed files for package",
					duration: Math.round(performance.now() - start),
					packageName: node.packageName,
					script: node.script,
					skipped: true,
				};
			}
		}

		const cache = normalizeBunCache(action.cache);
		const cacheLookup = cache.enabled
			? await checkTaskCache({
					action,
					appendChangedFiles: options.appendChangedFiles ?? false,
					changedFiles,
					gitRoot,
					node,
					scriptCommand,
				})
			: undefined;

		if (cacheLookup?.hit) {
			if (verbose) {
				console.log(`[${node.packageName}] cache hit`);
			}
			return {
				success: true,
				output: "Cache hit",
				duration: Math.round(performance.now() - start),
				packageName: node.packageName,
				script: node.script,
				cached: true,
			};
		}

		const args = ["bun", "run", node.script];
		if (options.appendChangedFiles && changedFiles.length > 0) {
			args.push("--", ...changedFiles);
		}

		const proc = await spawnProcessTree(args, {
			cwd: node.packagePath,
			env: {
				...process.env,
				...createChangedFilesEnv(changedFiles),
			},
		});
		const stdoutPromise = new Response(proc.stdout).text();
		const stderrPromise = new Response(proc.stderr).text();

		if (hardTimeoutMs !== undefined && hardTimeoutMs > 0) {
			timeoutId = setTimeout(() => {
				timedOut = true;
				proc.terminate();
			}, hardTimeoutMs);
			timeoutId.unref?.();
		}

		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			stdoutPromise,
			stderrPromise,
		]);
		const duration = Math.round(performance.now() - start);
		let output = normalizeOutput(stdout, stderr, verbose);

		if (verbose && output.trim()) {
			console.log(`[${node.packageName}] ${output}`);
		}

		if (timedOut) {
			const seconds = ((hardTimeoutMs ?? 0) / 1000).toFixed(2);
			const timeoutMessage = `Hard timeout after ${seconds}s; killed ${node.packageName}#${node.script}`;
			output = output ? `${output}\n${timeoutMessage}` : timeoutMessage;
		}

		const success = !timedOut && exitCode === 0;
		if (success && cacheLookup) {
			try {
				await writeTaskCacheSuccess(cacheLookup, node);
			} catch (e) {
				if (verbose) {
					const message = e instanceof Error ? e.message : String(e);
					console.warn(
						`Cache write failed for ${node.packageName}: ${message}`,
					);
				}
			}
		}

		return {
			success,
			output,
			duration,
			packageName: node.packageName,
			script: node.script,
		};
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
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
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
		const packageMap = new Map(packages.map((pkg) => [pkg.name, pkg]));

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
		const parallelLimit = getParallelLimit(action);

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

			const layerResults = await mapWithConcurrency(
				layer,
				parallelLimit,
				async (node) => {
					if (printer && stepName) {
						printer.updateNested(
							stepName,
							`${node.packageName}#${node.script}`,
							{
								status: "running",
							},
						);
					}

					const packageChangedFiles = scopeChangedFilesToDirectory(
						options.changedFiles ?? [],
						options.gitRoot,
						node.packagePath,
					);
					const scriptCommand =
						packageMap.get(node.packageName)?.scripts[node.script] ?? "";
					const result = await runPackageScript(
						action,
						node,
						scriptCommand,
						packageChangedFiles,
						options.gitRoot,
						getHardTimeoutMs(action),
						options.verbose,
						{
							appendChangedFiles: options.appendChangedFiles,
							changedFilesSpecified: options.changedFilesSpecified,
						},
					);

					// Update printer with result
					if (printer && stepName) {
						printer.updateNested(
							stepName,
							`${node.packageName}#${node.script}`,
							{
								status: result.success ? "done" : "failed",
								duration: result.duration,
							},
						);
					}

					return result;
				},
			);

			for (const result of layerResults) {
				results.push(result);

				const status = result.success ? "✓" : "✗";
				const duration = result.cached
					? "cached"
					: result.skipped
						? "no changed files"
						: `${result.duration}ms`;
				logs.push(
					`  ${status} ${result.packageName}#${result.script} (${duration})`,
				);

				if (!result.success) {
					totalSuccess = false;
					// Don't append partial error here, we'll show full logs at the end
				}
			}

			// If any task in this layer failed, skip remaining layers
			if (!totalSuccess) {
				break;
			}
		}

		const passed = results.filter(
			(r) => r.success && !r.cached && !r.skipped,
		).length;
		const cached = results.filter((r) => r.cached).length;
		const skipped = results.filter((r) => r.skipped).length;
		const failed = results.filter((r) => !r.success).length;

		const successParts: string[] = [];
		if (passed > 0 || (cached === 0 && skipped === 0)) {
			successParts.push(`${passed} packages passed`);
		}
		if (cached > 0) successParts.push(`${cached} cached`);
		if (skipped > 0) successParts.push(`${skipped} skipped`);

		let output = totalSuccess
			? successParts.join(", ")
			: `${logs.join("\n")}\n\nCompleted: ${passed} passed, ${cached} cached, ${skipped} skipped, ${failed} failed`;

		if (!totalSuccess) {
			const failedResults = results.filter((r) => !r.success);
			output += "\n\nErrors:";
			for (const result of failedResults) {
				output += `\n\n--- ${result.packageName}#${result.script} ---\n`;
				output += result.output;
			}
		}

		return {
			success: totalSuccess,
			output,
		};
	});
}
