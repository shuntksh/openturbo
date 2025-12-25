import { describe, expect, test } from "bun:test";
import { createColorizer } from "./colors";
import { formatDuration, formatStepLine } from "./formatting";
import type { StepState } from "./types";

describe("formatDuration", () => {
	test("formats milliseconds for duration < 1000ms", () => {
		expect(formatDuration(0)).toBe("0ms");
		expect(formatDuration(150)).toBe("150ms");
		expect(formatDuration(999)).toBe("999ms");
	});

	test("formats seconds for duration >= 1000ms", () => {
		expect(formatDuration(1000)).toBe("1.00s");
		expect(formatDuration(1500)).toBe("1.50s");
		expect(formatDuration(2345)).toBe("2.35s");
		expect(formatDuration(10000)).toBe("10.00s");
	});
});

describe("formatStepLine", () => {
	const noColor = createColorizer(false);

	const makeState = (status: StepState["status"], duration = 0): StepState => ({
		duration,
		output: "",
		status,
		step: { name: "test-step" },
	});

	test("formats pending step", () => {
		const line = formatStepLine(makeState("pending"), noColor);
		expect(line).toContain("○");
		expect(line).toContain("test-step");
		expect(line).toContain("waiting...");
	});

	test("formats running step", () => {
		const line = formatStepLine(makeState("running"), noColor);
		expect(line).toContain("◐");
		expect(line).toContain("test-step");
		expect(line).toContain("running...");
	});

	test("formats done step with duration", () => {
		const line = formatStepLine(makeState("done", 1500), noColor);
		expect(line).toContain("✓");
		expect(line).toContain("test-step");
		expect(line).toContain("(1.50s)");
	});

	test("formats failed step with duration", () => {
		const line = formatStepLine(makeState("failed", 250), noColor);
		expect(line).toContain("✗");
		expect(line).toContain("test-step");
		expect(line).toContain("(250ms)");
	});

	test("formats skipped step", () => {
		const line = formatStepLine(makeState("skipped"), noColor);
		expect(line).toContain("○");
		expect(line).toContain("test-step");
		expect(line).toContain("skipped");
	});

	test("pads step name to 16 characters", () => {
		const line = formatStepLine(makeState("pending"), noColor);
		// "test-step" is 9 chars, should be padded to 16
		expect(line).toContain("test-step       ");
	});
});
