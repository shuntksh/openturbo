/**
 * Graph handler - displays dependency graph visualization.
 */

import type { ColorFn, Step } from "../mod";

import {
	buildDependencyGraph,
	discoverWorkspaces,
	resolveTaskDependencies,
	topologicalSort,
} from "../npm-workspace";

export async function handleGraph(
	steps: readonly Step[],
	c: ColorFn,
	gitRoot: string,
): Promise<void> {
	console.log();
	console.log(c("bold", "  Dependency Graph"));
	console.log();

	const depths = new Map<string, number>();
	const stepMap = new Map(steps.map((s) => [s.name, s]));
	const visiting = new Set<string>();

	function getDepth(name: string): number {
		if (visiting.has(name)) {
			throw new Error(`Circular dependency detected: "${name}"`);
		}
		const cached = depths.get(name);
		if (cached !== undefined) return cached;

		visiting.add(name);
		const step = stepMap.get(name);
		if (!step) {
			throw new Error(`Step "${name}" not found`);
		}
		if (!step.dependsOn || step.dependsOn.length === 0) {
			depths.set(name, 0);
			visiting.delete(name);
			return 0;
		}

		const maxDepDepth = Math.max(...step.dependsOn.map((d) => getDepth(d)));
		const depth = maxDepDepth + 1;
		depths.set(name, depth);
		visiting.delete(name);
		return depth;
	}

	for (const step of steps) {
		getDepth(step.name);
	}

	const layers = new Map<number, Step[]>();
	for (const step of steps) {
		const depth = depths.get(step.name) ?? 0;
		const layer = layers.get(depth) ?? [];
		layer.push(step);
		layers.set(depth, layer);
	}

	const maxDepth = Math.max(...layers.keys());
	for (let d = 0; d <= maxDepth; d++) {
		const layer = layers.get(d) ?? [];
		const names = layer.map((s) => c("cyan", s.name)).join(c("dim", " | "));
		const parallel = layer.length > 1 ? c("dim", " (parallel)") : "";
		console.log(`  ${c("dim", `[${d}]`)} ${names}${parallel}`);

		// Show nested bun action details
		for (const step of layer) {
			if (step.bun) {
				const bunAction = step.bun; // Capture for type narrowing in callbacks
				try {
					const packages = await discoverWorkspaces(gitRoot);
					const packagesWithScript = packages.filter(
						(p) => bunAction.script in p.scripts,
					);

					if (packagesWithScript.length > 0) {
						const dependencyGraph = buildDependencyGraph(packages);
						const nodes = resolveTaskDependencies(
							bunAction.script,
							bunAction.dependsOn ?? [],
							packages,
							dependencyGraph,
						);
						const taskLayers = topologicalSort(nodes);

						console.log(c("dim", `       └─ ${step.name} (bun):`));
						for (let i = 0; i < taskLayers.length; i++) {
							const taskLayer = taskLayers[i];
							if (!taskLayer) continue;
							const taskNames = taskLayer
								.map((n) => c("yellow", `${n.packageName}#${n.script}`))
								.join(c("dim", " | "));
							const taskParallel =
								taskLayer.length > 1 ? c("dim", " (parallel)") : "";
							console.log(
								`          ${c("dim", `[${i}]`)} ${taskNames}${taskParallel}`,
							);
						}
					}
				} catch {
					// Silently skip if workspace discovery fails
				}
			}
		}

		if (d < maxDepth) {
			console.log(c("dim", "   ↓"));
		}
	}
	console.log();
}
