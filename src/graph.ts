/**
 * Dependency graph utilities.
 */

import type { Step } from "./types";

/**
 * Resolves a set of steps and all their transitive dependencies.
 *
 * @param steps - All available steps
 * @param requestedNames - Names of steps to include
 * @returns Steps in dependency order (dependencies first)
 * @throws Error if circular dependency or missing step detected
 *
 * @example
 * ```ts
 * const steps = [
 *   { name: "build", dependsOn: ["lint"] },
 *   { name: "lint" },
 *   { name: "test", dependsOn: ["build"] },
 * ];
 * resolveStepsWithDeps(steps, ["test"]);
 * // Returns: [lint, build, test]
 * ```
 */
export function resolveStepsWithDeps(
	steps: readonly Step[],
	requestedNames: readonly string[],
): Step[] {
	const stepMap = new Map(steps.map((s) => [s.name, s]));
	const needed = new Set<string>();
	const visiting = new Set<string>();

	function addWithDeps(name: string): void {
		if (needed.has(name)) return;
		if (visiting.has(name)) {
			throw new Error(`Circular dependency detected involving step: "${name}"`);
		}
		const step = stepMap.get(name);
		if (!step) throw new Error(`Step "${name}" not found`);

		visiting.add(name);
		for (const dep of step.dependsOn ?? []) {
			addWithDeps(dep);
		}
		visiting.delete(name);
		needed.add(name);
	}

	for (const name of requestedNames) {
		addWithDeps(name);
	}

	return steps.filter((s) => needed.has(s.name));
}
