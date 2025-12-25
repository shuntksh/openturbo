import { describe, expect, test } from "bun:test";
import { resolveStepsWithDeps } from "./graph";
import type { Step } from "./types";

describe("resolveStepsWithDeps", () => {
	test("returns requested step with no dependencies", () => {
		const steps: Step[] = [
			{ name: "lint", cmd: "bun lint" },
			{ name: "test", cmd: "bun test" },
		];

		const result = resolveStepsWithDeps(steps, ["lint"]);
		expect(result.map((s) => s.name)).toEqual(["lint"]);
	});

	test("includes direct dependencies", () => {
		const steps: Step[] = [
			{ name: "lint", cmd: "bun lint" },
			{ name: "build", cmd: "bun build", dependsOn: ["lint"] },
		];

		const result = resolveStepsWithDeps(steps, ["build"]);
		expect(result.map((s) => s.name)).toEqual(["lint", "build"]);
	});

	test("includes transitive dependencies", () => {
		const steps: Step[] = [
			{ name: "lint", cmd: "bun lint" },
			{ name: "build", cmd: "bun build", dependsOn: ["lint"] },
			{ name: "test", cmd: "bun test", dependsOn: ["build"] },
		];

		const result = resolveStepsWithDeps(steps, ["test"]);
		expect(result.map((s) => s.name)).toEqual(["lint", "build", "test"]);
	});

	test("deduplicates shared dependencies", () => {
		const steps: Step[] = [
			{ name: "lint", cmd: "bun lint" },
			{ name: "build", cmd: "bun build", dependsOn: ["lint"] },
			{ name: "test", cmd: "bun test", dependsOn: ["lint"] },
		];

		const result = resolveStepsWithDeps(steps, ["build", "test"]);
		expect(result.map((s) => s.name)).toEqual(["lint", "build", "test"]);
	});

	test("handles multiple requested steps", () => {
		const steps: Step[] = [
			{ name: "a", cmd: "a" },
			{ name: "b", cmd: "b" },
			{ name: "c", cmd: "c" },
		];

		const result = resolveStepsWithDeps(steps, ["a", "c"]);
		expect(result.map((s) => s.name)).toEqual(["a", "c"]);
	});

	test("preserves original step order from input", () => {
		const steps: Step[] = [
			{ name: "z", cmd: "z" },
			{ name: "a", cmd: "a" },
			{ name: "m", cmd: "m" },
		];

		const result = resolveStepsWithDeps(steps, ["a", "z", "m"]);
		// Order should match original steps array
		expect(result.map((s) => s.name)).toEqual(["z", "a", "m"]);
	});

	test("throws on circular dependency", () => {
		const steps: Step[] = [
			{ name: "a", cmd: "a", dependsOn: ["b"] },
			{ name: "b", cmd: "b", dependsOn: ["a"] },
		];

		expect(() => resolveStepsWithDeps(steps, ["a"])).toThrow(
			/Circular dependency detected/,
		);
	});

	test("throws on self-dependency", () => {
		const steps: Step[] = [{ name: "a", cmd: "a", dependsOn: ["a"] }];

		expect(() => resolveStepsWithDeps(steps, ["a"])).toThrow(
			/Circular dependency detected/,
		);
	});

	test("throws on missing step", () => {
		const steps: Step[] = [{ name: "a", cmd: "a" }];

		expect(() => resolveStepsWithDeps(steps, ["b"])).toThrow(
			/Step "b" not found/,
		);
	});

	test("throws on missing dependency", () => {
		const steps: Step[] = [{ name: "a", cmd: "a", dependsOn: ["missing"] }];

		expect(() => resolveStepsWithDeps(steps, ["a"])).toThrow(
			/Step "missing" not found/,
		);
	});

	test("handles empty requested names", () => {
		const steps: Step[] = [{ name: "a", cmd: "a" }];

		const result = resolveStepsWithDeps(steps, []);
		expect(result).toEqual([]);
	});

	test("handles steps with no dependsOn field", () => {
		const steps: Step[] = [{ name: "a", cmd: "a" }];

		const result = resolveStepsWithDeps(steps, ["a"]);
		expect(result.map((s) => s.name)).toEqual(["a"]);
	});
});
