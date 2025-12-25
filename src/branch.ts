/**
 * Branch pattern matching utilities.
 */

/**
 * Simple glob matching: `*` matches any characters, `?` matches a single character.
 *
 * @param text - Text to match
 * @param pattern - Glob pattern
 * @returns True if the text matches the pattern
 */
export function matchGlob(text: string, pattern: string): boolean {
	const regex = new RegExp(
		`^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
	);
	return regex.test(text);
}

/**
 * Matches a branch against a pattern, handling special prefixes.
 *
 * Patterns:
 * - `worktree:*` - Only matches if in a worktree
 * - `!pattern` - Negation, returns true if pattern does NOT match
 * - `pattern` - Standard glob match
 *
 * @param branch - Current branch name
 * @param pattern - Pattern to match against
 * @param inWorktree - Whether currently in a Git worktree
 * @returns True if the branch matches the pattern
 */
export function matchBranchPattern(
	branch: string,
	pattern: string,
	inWorktree: boolean,
): boolean {
	// Handle worktree: prefix
	if (pattern.startsWith("worktree:")) {
		if (!inWorktree) return false;
		const branchPattern = pattern.slice(9); // Remove "worktree:"
		if (branchPattern === "*") return true;
		return matchGlob(branch, branchPattern);
	}

	// Handle negation
	if (pattern.startsWith("!")) {
		return !matchGlob(branch, pattern.slice(1));
	}

	return matchGlob(branch, pattern);
}

/**
 * Determines if a step should run based on branch filter patterns.
 *
 * Rules:
 * - Empty/undefined branches array means run on all branches
 * - All negation patterns must pass (AND logic)
 * - At least one positive pattern must match (OR logic)
 *
 * @param branches - Branch filter patterns
 * @param currentBranch - Current branch name
 * @param inWorktree - Whether currently in a Git worktree
 * @returns True if the step should run on the current branch
 */
export function shouldRunOnBranch(
	branches: readonly string[] | undefined,
	currentBranch: string,
	inWorktree: boolean,
): boolean {
	if (!branches || branches.length === 0) return true;

	// All patterns must match (AND logic for negations, OR for positive)
	const negations = branches.filter((b) => b.startsWith("!"));
	const positives = branches.filter((b) => !b.startsWith("!"));

	// All negations must pass
	for (const neg of negations) {
		if (!matchBranchPattern(currentBranch, neg, inWorktree)) {
			return false;
		}
	}

	// If there are positive patterns, at least one must match
	if (positives.length > 0) {
		return positives.some((p) =>
			matchBranchPattern(currentBranch, p, inWorktree),
		);
	}

	return true;
}
