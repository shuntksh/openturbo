/**
 * ANSI escape codes and terminal colorization utilities.
 */

import type { ColorFn, ColorKey } from "./types";

/**
 * ANSI escape sequences for terminal control.
 */
export const ANSI = {
	clearLine: "\x1b[2K",
	cursorUp: (n: number) => `\x1b[${n}A`,
	hideCursor: "\x1b[?25l",
	showCursor: "\x1b[?25h",
} as const;

/**
 * ANSI color codes.
 */
export const COLORS: Record<ColorKey, string> = {
	blue: "\x1b[34m",
	bold: "\x1b[1m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	reset: "\x1b[0m",
	yellow: "\x1b[33m",
} as const;

/**
 * Creates a colorizer function that wraps text with ANSI color codes.
 *
 * @param enabled - Whether color output is enabled
 * @returns A function that applies colors to text
 *
 * @example
 * ```ts
 * const c = createColorizer(true);
 * console.log(c("green", "Success!")); // green text
 *
 * const noColor = createColorizer(false);
 * console.log(noColor("green", "Success!")); // plain text
 * ```
 */
export function createColorizer(enabled: boolean): ColorFn {
	return (color: ColorKey, text: string): string => {
		if (!enabled) return text;
		return `${COLORS[color]}${text}${COLORS.reset}`;
	};
}
