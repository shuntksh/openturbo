import { describe, expect, test } from "bun:test";
import { ANSI, COLORS, createColorizer } from "./colors";

describe("ANSI", () => {
	test("clearLine is correct escape sequence", () => {
		expect(ANSI.clearLine).toBe("\x1b[2K");
	});

	test("cursorUp generates correct escape sequence", () => {
		expect(ANSI.cursorUp(3)).toBe("\x1b[3A");
		expect(ANSI.cursorUp(1)).toBe("\x1b[1A");
	});

	test("hideCursor is correct escape sequence", () => {
		expect(ANSI.hideCursor).toBe("\x1b[?25l");
	});

	test("showCursor is correct escape sequence", () => {
		expect(ANSI.showCursor).toBe("\x1b[?25h");
	});
});

describe("COLORS", () => {
	test("has all expected color codes", () => {
		expect(COLORS.blue).toBe("\x1b[34m");
		expect(COLORS.bold).toBe("\x1b[1m");
		expect(COLORS.cyan).toBe("\x1b[36m");
		expect(COLORS.dim).toBe("\x1b[2m");
		expect(COLORS.green).toBe("\x1b[32m");
		expect(COLORS.red).toBe("\x1b[31m");
		expect(COLORS.reset).toBe("\x1b[0m");
		expect(COLORS.yellow).toBe("\x1b[33m");
	});
});

describe("createColorizer", () => {
	test("returns raw text when disabled", () => {
		const c = createColorizer(false);
		expect(c("green", "Success")).toBe("Success");
		expect(c("red", "Error")).toBe("Error");
		expect(c("bold", "Title")).toBe("Title");
	});

	test("wraps text with ANSI codes when enabled", () => {
		const c = createColorizer(true);
		expect(c("green", "Success")).toBe("\x1b[32mSuccess\x1b[0m");
		expect(c("red", "Error")).toBe("\x1b[31mError\x1b[0m");
		expect(c("bold", "Title")).toBe("\x1b[1mTitle\x1b[0m");
	});

	test("handles empty string", () => {
		const c = createColorizer(true);
		expect(c("blue", "")).toBe("\x1b[34m\x1b[0m");
	});
});
