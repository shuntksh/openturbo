import { describe, expect, test } from "bun:test";
import { matchBranchPattern, matchGlob, shouldRunOnBranch } from "./branch";

describe("matchGlob", () => {
	test("matches exact strings", () => {
		expect(matchGlob("main", "main")).toBe(true);
		expect(matchGlob("develop", "main")).toBe(false);
	});

	test("matches wildcard *", () => {
		expect(matchGlob("feature-123", "feature-*")).toBe(true);
		expect(matchGlob("feature-test-branch", "feature-*")).toBe(true);
		expect(matchGlob("hotfix-123", "feature-*")).toBe(false);
	});

	test("matches question mark ?", () => {
		expect(matchGlob("v1", "v?")).toBe(true);
		expect(matchGlob("v12", "v?")).toBe(false);
		expect(matchGlob("v", "v?")).toBe(false);
	});

	test("matches complex patterns", () => {
		expect(matchGlob("release-v1.0", "release-v?.?")).toBe(true);
		expect(matchGlob("prefix-anything-suffix", "prefix-*-suffix")).toBe(true);
	});
});

describe("matchBranchPattern", () => {
	describe("worktree: prefix", () => {
		test("returns false when not in worktree", () => {
			expect(matchBranchPattern("feature-123", "worktree:*", false)).toBe(
				false,
			);
			expect(matchBranchPattern("main", "worktree:main", false)).toBe(false);
		});

		test("matches any branch with worktree:*", () => {
			expect(matchBranchPattern("feature-123", "worktree:*", true)).toBe(true);
			expect(matchBranchPattern("main", "worktree:*", true)).toBe(true);
		});

		test("matches specific pattern after worktree:", () => {
			expect(
				matchBranchPattern("feature-123", "worktree:feature-*", true),
			).toBe(true);
			expect(matchBranchPattern("main", "worktree:feature-*", true)).toBe(
				false,
			);
		});
	});

	describe("negation prefix", () => {
		test("returns true when branch does not match negated pattern", () => {
			expect(matchBranchPattern("develop", "!main", false)).toBe(true);
			expect(matchBranchPattern("feature-123", "!main", false)).toBe(true);
		});

		test("returns false when branch matches negated pattern", () => {
			expect(matchBranchPattern("main", "!main", false)).toBe(false);
		});

		test("supports glob in negation", () => {
			expect(matchBranchPattern("develop", "!feature-*", false)).toBe(true);
			expect(matchBranchPattern("feature-123", "!feature-*", false)).toBe(
				false,
			);
		});
	});

	describe("plain pattern", () => {
		test("matches using glob", () => {
			expect(matchBranchPattern("main", "main", false)).toBe(true);
			expect(matchBranchPattern("feature-123", "feature-*", false)).toBe(true);
		});
	});
});

describe("shouldRunOnBranch", () => {
	test("returns true for undefined branches", () => {
		expect(shouldRunOnBranch(undefined, "main", false)).toBe(true);
	});

	test("returns true for empty branches array", () => {
		expect(shouldRunOnBranch([], "main", false)).toBe(true);
	});

	describe("positive patterns", () => {
		test("runs when at least one pattern matches", () => {
			expect(shouldRunOnBranch(["main", "develop"], "main", false)).toBe(true);
			expect(shouldRunOnBranch(["main", "develop"], "develop", false)).toBe(
				true,
			);
		});

		test("does not run when no pattern matches", () => {
			expect(shouldRunOnBranch(["main", "develop"], "feature-x", false)).toBe(
				false,
			);
		});
	});

	describe("negation patterns", () => {
		test("runs when all negations pass", () => {
			expect(shouldRunOnBranch(["!main", "!develop"], "feature-x", false)).toBe(
				true,
			);
		});

		test("does not run when any negation fails", () => {
			expect(shouldRunOnBranch(["!main", "!develop"], "main", false)).toBe(
				false,
			);
		});
	});

	describe("mixed patterns", () => {
		test("requires negations to pass AND at least one positive to match", () => {
			// feature-* matches positive, !main passes negation
			expect(
				shouldRunOnBranch(["feature-*", "!main"], "feature-123", false),
			).toBe(true);
			// main fails the !main negation
			expect(shouldRunOnBranch(["feature-*", "!main"], "main", false)).toBe(
				false,
			);
			// develop doesn't match feature-*
			expect(shouldRunOnBranch(["feature-*", "!main"], "develop", false)).toBe(
				false,
			);
		});
	});

	describe("worktree patterns", () => {
		test("worktree:* only runs in worktree", () => {
			expect(shouldRunOnBranch(["worktree:*"], "any-branch", true)).toBe(true);
			expect(shouldRunOnBranch(["worktree:*"], "any-branch", false)).toBe(
				false,
			);
		});
	});
});
