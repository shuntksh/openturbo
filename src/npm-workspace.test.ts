/**
 * Tests for workspace discovery and dependency graph construction.
 */

import { describe, expect, test } from "bun:test";
import {
	buildDependencyGraph,
	resolveTaskDependencies,
	type TaskNode,
	topologicalSort,
	type WorkspacePackage,
} from "./npm-workspace";

describe("buildDependencyGraph", () => {
	test("creates graph from package workspace dependencies", () => {
		const packages: WorkspacePackage[] = [
			{
				name: "@org/a",
				path: "/packages/a",
				scripts: { test: "bun test" },
				workspaceDeps: ["@org/b", "@org/c"],
			},
			{
				name: "@org/b",
				path: "/packages/b",
				scripts: { test: "bun test" },
				workspaceDeps: ["@org/c"],
			},
			{
				name: "@org/c",
				path: "/packages/c",
				scripts: { test: "bun test" },
				workspaceDeps: [],
			},
		];

		const graph = buildDependencyGraph(packages);

		expect(graph.get("@org/a")).toEqual(["@org/b", "@org/c"]);
		expect(graph.get("@org/b")).toEqual(["@org/c"]);
		expect(graph.get("@org/c")).toEqual([]);
	});

	test("handles empty packages array", () => {
		const graph = buildDependencyGraph([]);
		expect(graph.size).toBe(0);
	});
});

describe("resolveTaskDependencies", () => {
	const packages: WorkspacePackage[] = [
		{
			name: "@org/engine",
			path: "/packages/engine",
			scripts: { test: "bun test", build: "bun build" },
			workspaceDeps: ["@org/internals"],
		},
		{
			name: "@org/internals",
			path: "/packages/internals",
			scripts: { test: "bun test", build: "bun build" },
			workspaceDeps: [],
		},
		{
			name: "@org/hcl",
			path: "/packages/hcl",
			scripts: { test: "bun test" },
			workspaceDeps: ["@org/internals"],
		},
	];

	const graph = buildDependencyGraph(packages);

	test("resolves ^task dependency to workspace deps", () => {
		const nodes = resolveTaskDependencies("test", ["^test"], packages, graph);

		expect(nodes).toHaveLength(3);

		const engineNode = nodes.find((n) => n.packageName === "@org/engine");
		expect(engineNode?.dependencies).toContain("@org/internals#test");

		const internalsNode = nodes.find((n) => n.packageName === "@org/internals");
		expect(internalsNode?.dependencies).toEqual([]);

		const hclNode = nodes.find((n) => n.packageName === "@org/hcl");
		expect(hclNode?.dependencies).toContain("@org/internals#test");
	});

	test("resolves package#task explicit dependency", () => {
		const nodes = resolveTaskDependencies(
			"test",
			["@org/internals#build"],
			packages,
			graph,
		);

		for (const node of nodes) {
			expect(node.dependencies).toContain("@org/internals#build");
		}
	});

	test("handles packages without the script", () => {
		const nodes = resolveTaskDependencies("build", ["^build"], packages, graph);

		// Only engine and internals have build script
		expect(nodes).toHaveLength(2);
		expect(nodes.map((n) => n.packageName)).toContain("@org/engine");
		expect(nodes.map((n) => n.packageName)).toContain("@org/internals");
	});

	test("handles empty dependsOn", () => {
		const nodes = resolveTaskDependencies("test", [], packages, graph);

		expect(nodes).toHaveLength(3);
		for (const node of nodes) {
			expect(node.dependencies).toEqual([]);
		}
	});
});

describe("topologicalSort", () => {
	test("sorts nodes into parallel layers", () => {
		const nodes: TaskNode[] = [
			{
				packageName: "@org/engine",
				packagePath: "/packages/engine",
				script: "test",
				dependencies: ["@org/internals#test"],
			},
			{
				packageName: "@org/internals",
				packagePath: "/packages/internals",
				script: "test",
				dependencies: [],
			},
			{
				packageName: "@org/hcl",
				packagePath: "/packages/hcl",
				script: "test",
				dependencies: ["@org/internals#test"],
			},
		];

		const layers = topologicalSort(nodes);

		expect(layers).toHaveLength(2);

		// First layer: internals (no deps)
		expect(layers[0]).toHaveLength(1);
		expect(layers[0]?.[0]?.packageName).toBe("@org/internals");

		// Second layer: engine and hcl (both depend on internals)
		expect(layers[1]).toHaveLength(2);
		const layer1Names = layers[1]?.map((n) => n.packageName) ?? [];
		expect(layer1Names).toContain("@org/engine");
		expect(layer1Names).toContain("@org/hcl");
	});

	test("handles empty nodes", () => {
		const layers = topologicalSort([]);
		expect(layers).toEqual([]);
	});

	test("handles single node", () => {
		const nodes: TaskNode[] = [
			{
				packageName: "@org/a",
				packagePath: "/packages/a",
				script: "test",
				dependencies: [],
			},
		];

		const layers = topologicalSort(nodes);
		expect(layers).toHaveLength(1);
		expect(layers[0]).toHaveLength(1);
	});

	test("detects circular dependencies", () => {
		const nodes: TaskNode[] = [
			{
				packageName: "@org/a",
				packagePath: "/packages/a",
				script: "test",
				dependencies: ["@org/b#test"],
			},
			{
				packageName: "@org/b",
				packagePath: "/packages/b",
				script: "test",
				dependencies: ["@org/a#test"],
			},
		];

		expect(() => topologicalSort(nodes)).toThrow(/Circular dependency/);
	});

	test("sorts multi-layer dependencies correctly", () => {
		const nodes: TaskNode[] = [
			{
				packageName: "@org/app",
				packagePath: "/packages/app",
				script: "test",
				dependencies: ["@org/lib#test"],
			},
			{
				packageName: "@org/lib",
				packagePath: "/packages/lib",
				script: "test",
				dependencies: ["@org/core#test"],
			},
			{
				packageName: "@org/core",
				packagePath: "/packages/core",
				script: "test",
				dependencies: [],
			},
		];

		const layers = topologicalSort(nodes);

		expect(layers).toHaveLength(3);
		expect(layers[0]?.[0]?.packageName).toBe("@org/core");
		expect(layers[1]?.[0]?.packageName).toBe("@org/lib");
		expect(layers[2]?.[0]?.packageName).toBe("@org/app");
	});
});
