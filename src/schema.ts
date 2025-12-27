import { z } from "zod";

// Shared type definitions converted to Zod schemas

/**
 * Worktree copy action configuration.
 */
export const WorktreeCpActionSchema = z.object({
	from: z.string(),
	files: z.array(z.string()),
	allowMissing: z.boolean().optional(),
});

/**
 * Bun action configuration for workspace-aware script execution.
 */
export const BunActionSchema = z.object({
	/** Script name to run (matches package.json scripts) */
	script: z.string(),
	/** Timeout in milliseconds (default: no timeout) */
	timeout: z.number().optional(),
	/** Turborepo-style dependencies: ^task, task, package#task */
	dependsOn: z.array(z.string()).optional(),
});

/**
 * A single step in a workflow.
 */
export const StepSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	dependsOn: z.array(z.string()).optional(),
	branches: z.array(z.string()).optional(),
	cmd: z.string().optional(),
	"worktree:cp": WorktreeCpActionSchema.optional(),
	bun: BunActionSchema.optional(),
});

/**
 * A workflow can be an array of steps or an object with a steps property.
 */
export const WorkflowSchema = z.union([
	z.array(StepSchema),
	z.object({ steps: z.array(StepSchema) }),
]);

/**
 * Worktree hook configuration.
 */
export const WorktreeHookSchema = z.union([
	z.object({
		type: z.literal("copy"),
		from: z.string(),
		to: z.string(),
	}),
	z.object({
		cmd: z.string(),
	}),
]);

/**
 * Worktree management configuration.
 */
export const WorktreeConfigSchema = z.object({
	defaults: z
		.object({
			/** Base directory for worktrees (relative to git root), default: ../worktrees */
			base_dir: z.string().optional(),
		})
		.optional(),
	hooks: z
		.object({
			post_create: z.array(WorktreeHookSchema).optional(),
		})
		.optional(),
});

/**
 * Runner configuration containing workflow definitions.
 */
export const ConfigSchema = z.object({
	workflows: z.record(z.string(), WorkflowSchema),
	worktree: WorktreeConfigSchema.optional(),
});

// Export inferred types
export type WorktreeCpAction = z.infer<typeof WorktreeCpActionSchema>;
export type BunAction = z.infer<typeof BunActionSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorktreeHook = z.infer<typeof WorktreeHookSchema>;
export type WorktreeConfig = z.infer<typeof WorktreeConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
