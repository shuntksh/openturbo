/**
 * Configuration parsing utilities.
 */

import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Config, Step, Workflow } from "./types";

/**
 * Loads configuration from potential config files.
 *
 * @param explicitPath - Explicit path to config file provided by user
 * @param gitRoot - Root of the git repository
 * @returns Parsed configuration
 */
export async function loadConfig(
	explicitPath: string | undefined,
	gitRoot: string,
): Promise<Config> {
	const candidates: string[] = [];

	if (explicitPath) {
		candidates.push(explicitPath);
	} else {
		let current = process.cwd();
		while (true) {
			candidates.push(
				join(current, "workflow.json"),
				join(current, "workflow.jsonc"),
				join(current, "workflows.json"),
				join(current, "workflows.jsonc"),
				join(current, "package.json"),
			);

			if (current === gitRoot) {
				// At git root, also check .config subfolder
				candidates.push(
					join(current, ".config", "workflow.json"),
					join(current, ".config", "workflow.jsonc"),
					join(current, ".config", "workflows.json"),
					join(current, ".config", "workflows.jsonc"),
				);
				break;
			}

			const parent = dirname(current);
			if (parent === current) break; // Reached filesystem root
			current = parent;
		}
	}

	for (const path of candidates) {
		if (!existsSync(path)) continue;

		const content = await Bun.file(path).text();
		const isJsonc = path.endsWith(".jsonc");
		const isPackageJson = basename(path) === "package.json";

		try {
			const parsed = JSON.parse(isJsonc ? stripJsonComments(content) : content);

			if (isPackageJson) {
				if (parsed.workflows) {
					// package.json only supports workflows, no top-level worktree config currently
					// strictly following the requirement that workflows.json captures wtp.yaml
					return { workflows: parsed.workflows };
				}
				continue; // Try next candidate if no workflows field
			}

			// Standalone config file
			if (parsed.workflows || parsed.worktree) {
				return {
					workflows: parsed.workflows || {},
					worktree: parsed.worktree,
				};
			}

			// Direct workflow definitions (legacy format)
			return { workflows: parsed };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			throw new Error(`Failed to parse ${path}: ${message}`);
		}
	}

	throw new Error(
		`No workflow config found. Checked:\n${candidates.map((c) => `  - ${c}`).join("\n")}`,
	);
}

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
