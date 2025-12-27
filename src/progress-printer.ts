/**
 * Centralized progress printer with virtual DOM-style diffing.
 *
 * Stores previously rendered lines and diffs against new state to
 * efficiently update only what changed.
 */

import { ANSI } from "./colors";
import type { ColorFn, StepStatus } from "./types";

/**
 * Nested task displayed under a step.
 */
export type NestedTask = {
	readonly id: string;
	status: "pending" | "running" | "done" | "failed";
	duration?: number;
};

/**
 * Step state for rendering.
 */
export type RenderStepState = {
	name: string;
	status: StepStatus;
	duration?: number;
	nested: NestedTask[];
	showNested: boolean;
};

/**
 * Options for creating a progress printer.
 */
export type ProgressPrinterOptions = {
	readonly isTTY: boolean;
	readonly c: ColorFn;
};

/**
 * Formats a step line for display.
 */
function formatStepLine(state: RenderStepState, c: ColorFn): string {
	const name = state.name.padEnd(16);
	const duration = state.duration
		? state.duration >= 1000
			? `(${(state.duration / 1000).toFixed(2)}s)`
			: `(${state.duration}ms)`
		: "";

	switch (state.status) {
		case "pending":
			return `  ${c("dim", "○")} ${c("dim", name)} ${c("dim", "waiting...")}`;
		case "running":
			return `  ${c("cyan", "◐")} ${c("cyan", name)} ${c("dim", "running...")}`;
		case "done":
			return `  ${c("green", "✓")} ${name} ${c("dim", duration)}`;
		case "failed":
			return `  ${c("red", "✗")} ${name} ${c("dim", duration)}`;
		case "skipped":
			return `  ${c("yellow", "○")} ${c("yellow", name)} ${c("dim", "skipped")}`;
		default:
			return `  ${c("dim", "○")} ${name}`;
	}
}

/**
 * Formats a nested task line for display.
 */
function formatNestedLine(task: NestedTask, c: ColorFn): string {
	const duration = task.duration ? `(${task.duration}ms)` : "";

	switch (task.status) {
		case "pending":
			return `      ${c("dim", "○")} ${c("dim", task.id)}`;
		case "running":
			return `      ${c("cyan", "◐")} ${c("cyan", task.id)}`;
		case "done":
			return `      ${c("green", "✓")} ${task.id} ${c("dim", duration)}`;
		case "failed":
			return `      ${c("red", "✗")} ${task.id} ${c("dim", duration)}`;
		default:
			return `      ${c("dim", "○")} ${task.id}`;
	}
}

/**
 * Centralized progress printer with VDOM-style diffing.
 *
 * Tracks previously rendered lines and diffs against new state.
 */
export class ProgressPrinter {
	readonly #steps: Map<string, RenderStepState>;
	readonly #stepOrder: readonly string[];
	readonly #isTTY: boolean;
	readonly #c: ColorFn;

	/** Previously rendered lines (the "old VDOM") */
	#renderedLines: string[] = [];
	#isRendered = false;

	constructor(stepNames: readonly string[], options: ProgressPrinterOptions) {
		this.#steps = new Map();
		this.#stepOrder = stepNames;
		this.#isTTY = options.isTTY;
		this.#c = options.c;

		for (const name of stepNames) {
			this.#steps.set(name, {
				name,
				status: "pending",
				nested: [],
				showNested: false,
			});
		}
	}

	/**
	 * Update a step's state and re-render.
	 */
	updateStep(
		name: string,
		update: Partial<Pick<RenderStepState, "status" | "duration">>,
	): void {
		const state = this.#steps.get(name);
		if (!state) return;

		if (update.status !== undefined) state.status = update.status;
		if (update.duration !== undefined) state.duration = update.duration;

		// Hide nested when step completes
		if (state.status === "done" || state.status === "failed") {
			state.showNested = false;
		}

		this.#reconcile();
	}

	/**
	 * Set nested tasks for a step.
	 */
	setNested(stepName: string, tasks: readonly NestedTask[]): void {
		const state = this.#steps.get(stepName);
		if (!state) return;

		state.nested = [...tasks];
		state.showNested = true;
		this.#reconcile();
	}

	/**
	 * Update a specific nested task.
	 */
	updateNested(
		stepName: string,
		taskId: string,
		update: Partial<Pick<NestedTask, "status" | "duration">>,
	): void {
		const state = this.#steps.get(stepName);
		if (!state) return;

		const task = state.nested.find((t) => t.id === taskId);
		if (!task) return;

		if (update.status !== undefined) task.status = update.status;
		if (update.duration !== undefined) task.duration = update.duration;

		this.#reconcile();
	}

	/**
	 * Initial render - call once before updates.
	 */
	initialRender(): void {
		if (this.#isRendered) return;

		if (this.#isTTY) {
			process.stdout.write(ANSI.hideCursor);
		}

		const newLines = this.#buildLines();
		for (const line of newLines) {
			console.log(line);
		}
		this.#renderedLines = newLines;
		this.#isRendered = true;
	}

	/**
	 * Build lines array from current state (the "new VDOM").
	 */
	#buildLines(): string[] {
		const lines: string[] = [];

		for (const name of this.#stepOrder) {
			const state = this.#steps.get(name);
			if (!state) continue;

			lines.push(formatStepLine(state, this.#c));

			if (state.showNested) {
				for (const task of state.nested) {
					lines.push(formatNestedLine(task, this.#c));
				}
			}
		}

		return lines;
	}

	/**
	 * Reconcile: diff old vs new lines and update terminal.
	 */
	#reconcile(): void {
		if (!this.#isRendered) return;
		if (!this.#isTTY) return;

		const oldLines = this.#renderedLines;
		const newLines = this.#buildLines();
		const maxLen = Math.max(oldLines.length, newLines.length);

		// Move cursor to start of our output area
		if (oldLines.length > 0) {
			process.stdout.write(ANSI.cursorUp(oldLines.length));
		}

		// Write each line, clearing as we go
		for (let i = 0; i < maxLen; i++) {
			process.stdout.write(ANSI.clearLine);
			if (i < newLines.length) {
				process.stdout.write(`${newLines[i]}\n`);
			} else {
				// Line was removed, just move down
				process.stdout.write("\n");
			}
		}

		// If new output is shorter, we've left empty lines - move cursor back up
		if (newLines.length < oldLines.length) {
			process.stdout.write(ANSI.cursorUp(oldLines.length - newLines.length));
		}

		this.#renderedLines = newLines;
	}

	/**
	 * Cleanup - show cursor.
	 */
	cleanup(): void {
		if (this.#isTTY) {
			process.stdout.write(ANSI.showCursor);
		}
	}
}

/**
 * Creates a progress printer for the given steps.
 */
export function createProgressPrinter(
	stepNames: readonly string[],
	options: ProgressPrinterOptions,
): ProgressPrinter {
	return new ProgressPrinter(stepNames, options);
}
