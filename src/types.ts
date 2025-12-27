/**
 * Shared type definitions for the job runner.
 */

/**
 * Worktree copy action configuration.
 */
export type WorktreeCpAction = {
	readonly from: string;
	readonly files: readonly string[];
	readonly allowMissing?: boolean;
};

/**
 * Bun action configuration for workspace-aware script execution.
 */
export type BunAction = {
	/** Script name to run (matches package.json scripts) */
	readonly script: string;
	/** Timeout in milliseconds (default: no timeout) */
	readonly timeout?: number;
	/** Turborepo-style dependencies: ^task, task, package#task */
	readonly dependsOn?: readonly string[];
};

/**
 * A single step in a workflow.
 */
export type Step = {
	readonly name: string;
	readonly description?: string;
	readonly dependsOn?: readonly string[];
	readonly branches?: readonly string[];
	readonly cmd?: string;
	readonly "worktree:cp"?: WorktreeCpAction;
	readonly bun?: BunAction;
};

/**
 * A workflow can be an array of steps or an object with a steps property.
 */
export type Workflow = readonly Step[] | { readonly steps: readonly Step[] };

/**
 * Worktree hook configuration.
 */
export type WorktreeHook =
	| {
			readonly type: "copy";
			readonly from: string;
			readonly to: string;
	  }
	| {
			readonly type: "command";
			readonly command: string;
	  };

/**
 * Worktree management configuration.
 */
export type WorktreeConfig = {
	readonly defaults?: {
		/** Base directory for worktrees (relative to git root), default: ../worktrees */
		readonly base_dir?: string;
	};
	readonly hooks?: {
		readonly post_create?: readonly WorktreeHook[];
	};
};

/**
 * Runner configuration containing workflow definitions.
 */
export type Config = {
	readonly workflows: Record<string, Workflow>;
	readonly worktree?: WorktreeConfig;
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
