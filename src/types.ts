// Re-export config types inferred from Zod schema
import {
	ConfigSchema,
	WorkflowSchema,
	StepSchema,
	BunActionSchema,
	WorktreeCpActionSchema,
	WorktreeHookSchema,
	WorktreeConfigSchema,
} from "./schema";

import type {
	Config,
	Workflow,
	Step,
	BunAction,
	WorktreeCpAction,
	WorktreeHook,
	WorktreeConfig,
} from "./schema";

export {
	ConfigSchema,
	WorkflowSchema,
	StepSchema,
	BunActionSchema,
	WorktreeCpActionSchema,
	WorktreeHookSchema,
	WorktreeConfigSchema,
};

export type {
	Config,
	Workflow,
	Step,
	BunAction,
	WorktreeCpAction,
	WorktreeHook,
	WorktreeConfig,
};

/**
 * Information about a Git worktree.
 */
export type WorktreeInfo = {
	readonly path: string;
	readonly branch: string;
	readonly isMain: boolean;
};

/**
 * Status of a step during execution.
 */
export type StepStatus = "done" | "failed" | "pending" | "running" | "skipped";

/**
 * Mutable state for tracking step execution.
 */
export type StepState = {
	duration: number;
	output: string;
	status: StepStatus;
	step: Step;
};

/**
 * Result of executing a step.
 */
export type StepResult = {
	readonly duration: number;
	readonly name: string;
	readonly output: string;
	readonly success: boolean;
};

/**
 * Color function type returned by createColorizer.
 */
export type ColorFn = (color: ColorKey, text: string) => string;

/**
 * Available color keys.
 */
export type ColorKey =
	| "blue"
	| "bold"
	| "cyan"
	| "dim"
	| "green"
	| "red"
	| "reset"
	| "yellow";

/**
 * Context passed to step runners.
 */
export type RunContext = {
	readonly c: ColorFn;
	readonly failFast: boolean;
	readonly gitRoot: string;
	readonly isTTY: boolean;
	readonly verbose: boolean;
	/** Optional progress printer for centralized display */
	readonly printer?: import("./progress-printer").ProgressPrinter;
};
