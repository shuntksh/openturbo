/**
 * Run handler - executes workflow steps with dependency resolution.
 */

import type { ColorFn, RunContext, Step, StepResult, StepState } from "../mod";

import {
	createProgressPrinter,
	formatDuration,
	GitUtil,
	getSteps,
	loadConfig,
	resolveStepsWithDeps,
	runBunAction,
	runCmdAction,
	runWorktreeCpAction,
	shouldRunOnBranch,
} from "../mod";

async function runStep(step: Step, ctx: RunContext): Promise<StepResult> {
	if (step.cmd) {
		const result = await runCmdAction(step.cmd, { verbose: ctx.verbose });
		return { ...result, name: step.name };
	}

	if (step["worktree:cp"]) {
		const result = await runWorktreeCpAction(step["worktree:cp"], {
			gitRoot: ctx.gitRoot,
			getWorktrees: GitUtil.getWorktrees,
			verbose: ctx.verbose,
		});
		return { ...result, name: step.name };
	}

	if (step.bun) {
		const result = await runBunAction(step.bun, {
			gitRoot: ctx.gitRoot,
			verbose: ctx.verbose,
			stepName: step.name,
			printer: ctx.printer,
		});
		return { ...result, name: step.name };
	}

	return {
		success: false,
		output: `Step "${step.name}" has no action defined`,
		duration: 0,
		name: step.name,
	};
}

function printFailureDetails(result: StepResult, c: ColorFn): void {
	console.log();
	console.log(c("red", `${"─".repeat(60)}`));
	console.log(c("red", `  FAILED: ${result.name}`));
	console.log(c("red", `${"─".repeat(60)}`));
	console.log();
	console.log(result.output);
}

function printSummary(
	states: readonly StepState[],
	totalDuration: number,
	c: ColorFn,
): void {
	const passed = states.filter((s) => s.status === "done").length;
	const failed = states.filter((s) => s.status === "failed").length;
	const skipped = states.filter(
		(s) => s.status === "skipped" || s.status === "pending",
	).length;

	console.log();

	if (failed === 0 && skipped === 0) {
		console.log(
			c("green", `✨ All ${passed} steps passed!`) +
				c("dim", ` (${formatDuration(totalDuration)})`),
		);
	} else {
		const parts: string[] = [];
		if (passed > 0) parts.push(c("green", `${passed} passed`));
		if (failed > 0) parts.push(c("red", `${failed} failed`));
		if (skipped > 0) parts.push(c("yellow", `${skipped} skipped`));
		console.log(
			`  ${parts.join(c("dim", " · "))} ${c("dim", `(${formatDuration(totalDuration)})`)}`,
		);
	}
}

async function runStepsWithDeps(
	steps: readonly Step[],
	ctx: RunContext,
	currentBranch: string,
	inWorktree: boolean,
): Promise<readonly StepState[]> {
	const { printer } = ctx;
	const states = new Map<string, StepState>();
	const stepNames = new Set(steps.map((s) => s.name));

	// Initialize all states
	for (const step of steps) {
		const shouldRun = shouldRunOnBranch(
			step.branches,
			currentBranch,
			inWorktree,
		);
		const status = shouldRun ? "pending" : "skipped";
		states.set(step.name, {
			duration: 0,
			output: "",
			status,
			step,
		});
		// Update printer with initial state
		printer?.updateStep(step.name, { status });
	}

	// Initial render
	printer?.initialRender();

	let hasFailed = false;
	const completed = new Set<string>();
	const running = new Map<string, Promise<StepResult>>();

	const _canRun = (step: Step): boolean => {
		for (const dep of step.dependsOn ?? []) {
			if (!stepNames.has(dep)) continue;
			const depState = states.get(dep);
			if (!depState || depState.status !== "done") {
				return false;
			}
		}
		return true;
	};

	const failures: StepResult[] = [];

	while (completed.size < steps.length) {
		for (const step of steps) {
			const state = states.get(step.name);
			if (!state || state.status !== "pending") continue;
			if (hasFailed && ctx.failFast) {
				state.status = "skipped";
				printer?.updateStep(step.name, { status: "skipped" });
				completed.add(step.name);
				continue;
			}
			const depStates = (step.dependsOn ?? [])
				.map((dep) => states.get(dep))
				.filter((d) => d && stepNames.has(d.step.name));

			// Skip this step if any of its dependencies failed or were skipped.
			if (
				depStates.some((s) => s?.status === "failed" || s?.status === "skipped")
			) {
				state.status = "skipped";
				printer?.updateStep(step.name, { status: "skipped" });
				completed.add(step.name);
				continue;
			}

			// Wait if any dependencies are not yet done.
			if (depStates.some((s) => s?.status !== "done")) {
				continue;
			}

			state.status = "running";
			printer?.updateStep(step.name, { status: "running" });

			const promise = runStep(step, ctx).then((result) => {
				const state = states.get(step.name);
				if (state) {
					state.status = result.success ? "done" : "failed";
					state.duration = result.duration;
					state.output = result.output;
				}
				printer?.updateStep(step.name, {
					status: result.success ? "done" : "failed",
					duration: result.duration,
				});
				if (!result.success) {
					hasFailed = true;
					failures.push(result);
				}
				completed.add(step.name);
				running.delete(step.name);
				return result;
			});

			running.set(step.name, promise);
		}

		if (running.size > 0) {
			await Promise.race(running.values());
		} else if (completed.size < steps.length) {
			break;
		}
	}

	// Cleanup printer
	printer?.cleanup();

	if (!ctx.verbose) {
		for (const failure of failures) {
			printFailureDetails(failure, ctx.c);
		}
	}

	return [...states.values()];
}

export type HandleRunOptions = {
	readonly jobName: string;
	readonly configPath: string | undefined;
	readonly verbose: boolean;
	readonly failFast: boolean;
	readonly isTTY: boolean;
	readonly c: ColorFn;
};

export async function handleRun(options: HandleRunOptions): Promise<number> {
	const { jobName, configPath, verbose, failFast, isTTY, c } = options;

	const gitRoot = await GitUtil.getGitRoot();
	const config = await loadConfig(configPath, gitRoot);
	const workflow = config.workflows[jobName];

	if (!workflow) {
		const available = Object.keys(config.workflows).join(", ");
		console.error(c("red", `Error: Job "${jobName}" not found`));
		console.error(c("dim", `Available jobs: ${available}`));
		return 1;
	}

	const steps = getSteps(workflow);
	const currentBranch = await GitUtil.getCurrentBranch();
	const inWorktree = await GitUtil.isInWorktree(gitRoot);

	console.log();
	console.log(c("bold", `Running: ${jobName}`));
	console.log(
		c("dim", `Branch: ${currentBranch}${inWorktree ? " (worktree)" : ""}`),
	);
	console.log(c("dim", `Steps: ${steps.length}`));
	console.log();

	// Create progress printer for centralized TTY display
	const stepNames = steps.map((s) => s.name);
	const printer = createProgressPrinter(stepNames, { isTTY, c });

	const ctx: RunContext = {
		c,
		failFast,
		gitRoot,
		isTTY,
		verbose,
		printer,
	};

	let stepsToRun: Step[];
	try {
		stepsToRun = resolveStepsWithDeps(steps, stepNames);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(c("red", `Error: ${message}`));
		return 1;
	}
	const startTime = performance.now();

	const states = await runStepsWithDeps(
		stepsToRun,
		ctx,
		currentBranch,
		inWorktree,
	);

	const totalDuration = Math.round(performance.now() - startTime);
	printSummary(states, totalDuration, c);

	const hasFailures = states.some((s) => s.status === "failed");
	return hasFailures ? 1 : 0;
}
