/**
 * Common action types and utilities.
 */

/**
 * Result of executing an action.
 */
export type ActionResult = {
	readonly success: boolean;
	readonly output: string;
	readonly duration: number;
};

/**
 * Wraps an action with timing logic.
 *
 * @param fn - The async function to execute
 * @returns Action result with duration
 */
export async function withTiming<T extends Omit<ActionResult, "duration">>(
	fn: () => Promise<T>,
): Promise<T & { duration: number }> {
	const start = performance.now();
	try {
		const result = await fn();
		const duration = Math.round(performance.now() - start);
		return { ...result, duration };
	} catch (e) {
		const duration = Math.round(performance.now() - start);
		const message = e instanceof Error ? e.message : String(e);
		return {
			success: false,
			output: message,
			duration,
		} as T & { duration: number };
	}
}
