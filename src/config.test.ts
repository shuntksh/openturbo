import { describe, expect, test } from "bun:test";
import { getSteps, stripJsonComments } from "./config";
import type { Step, Workflow } from "./types";

describe("stripJsonComments", () => {
	test("removes single-line comments", () => {
		const jsonc = `{
  "key": "value" // this is a comment
}`;
		// The comment is removed but trailing space before it remains
		const result = stripJsonComments(jsonc);
		expect(result).toContain('"key": "value"');
		expect(result).not.toContain("// this is a comment");
	});

	test("removes multiple single-line comments", () => {
		const jsonc = `{
  // comment 1
  "a": 1,
  // comment 2
  "b": 2
}`;
		const result = stripJsonComments(jsonc);
		expect(result).not.toContain("// comment");
		expect(result).toContain('"a": 1');
		expect(result).toContain('"b": 2');
	});

	test("removes multi-line comments", () => {
		const jsonc = `{
  /* this is
     a multi-line
     comment */
  "key": "value"
}`;
		const result = stripJsonComments(jsonc);
		expect(result).not.toContain("/*");
		expect(result).not.toContain("*/");
		expect(result).toContain('"key": "value"');
	});

	test("removes mixed comments", () => {
		const jsonc = `{
  // single line
  "a": 1, /* inline comment */
  "b": 2
}`;
		const result = stripJsonComments(jsonc);
		expect(result).not.toContain("//");
		expect(result).not.toContain("/*");
		expect(result).not.toContain("*/");
	});

	test("returns valid JSON that can be parsed", () => {
		const jsonc = `{
  // config version
  "version": 1,
  "name": "test" /* project name */
}`;
		const json = stripJsonComments(jsonc);
		const parsed = JSON.parse(json);
		expect(parsed).toEqual({ version: 1, name: "test" });
	});

	test("handles empty input", () => {
		expect(stripJsonComments("")).toBe("");
	});

	test("handles input without comments", () => {
		const json = '{"key": "value"}';
		expect(stripJsonComments(json)).toBe(json);
	});
});

describe("getSteps", () => {
	test("returns steps from array workflow", () => {
		const steps: readonly Step[] = [
			{ name: "step1", cmd: "echo 1" },
			{ name: "step2", cmd: "echo 2" },
		];
		const workflow: Workflow = steps;

		expect(getSteps(workflow)).toBe(steps);
	});

	test("returns steps from object workflow", () => {
		const steps: readonly Step[] = [
			{ name: "step1", cmd: "echo 1" },
			{ name: "step2", cmd: "echo 2" },
		];
		const workflow: Workflow = { steps };

		expect(getSteps(workflow)).toBe(steps);
	});

	test("handles empty steps array", () => {
		const workflow: Workflow = [];
		expect(getSteps(workflow)).toEqual([]);
	});

	test("handles empty steps in object form", () => {
		const workflow: Workflow = { steps: [] };
		expect(getSteps(workflow)).toEqual([]);
	});
});
