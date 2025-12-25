/**
 * Configuration parsing utilities.
 */

import type { Step, Workflow } from "./types";

/**
 * Strips single-line and multi-line comments from JSONC content.
 *
 * @param jsonc - JSONC string with comments
 * @returns JSON string with comments removed
 */
export function stripJsonComments(jsonc: string): string {
	// Remove single-line comments (// ...)
	let result = jsonc.replace(/\/\/.*$/gm, "");
	// Remove multi-line comments (/* ... */)
	result = result.replace(/\/\*[\s\S]*?\*\//g, "");
	return result;
}

/**
 * Extracts steps from a workflow, handling both array and object forms.
 *
 * @param workflow - Workflow definition (array or object with steps)
 * @returns Array of steps
 */
export function getSteps(workflow: Workflow): readonly Step[] {
	if ("steps" in workflow) {
		return workflow.steps;
	}
	return workflow;
}
