/**
 * Formatting utilities for the job runner.
 */

import type { ColorFn, StepState, StepStatus } from "./types";

/**
 * Formats a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., "150ms" or "2.35s")
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Formats a step state into a display line with icon, name, status, and duration.
 *
 * @param state - The step state to format
 * @param c - Colorizer function
 * @returns Formatted line string
 */
export function formatStepLine(state: StepState, c: ColorFn): string {
	const icons: Record<StepStatus, string> = {
		done: c("green", "✓"),
		failed: c("red", "✗"),
		pending: c("dim", "○"),
		running: c("yellow", "◐"),
		skipped: c("dim", "○"),
	};

	const icon = icons[state.status];
	const duration =
		state.status === "done" || state.status === "failed"
			? c("dim", `(${formatDuration(state.duration)})`)
			: "";
	const statusText =
		state.status === "running"
			? c("dim", "running...")
			: state.status === "pending"
				? c("dim", "waiting...")
				: state.status === "skipped"
					? c("dim", "skipped")
					: "";

	return `  ${icon} ${state.step.name.padEnd(16)} ${statusText}${duration}`;
}
