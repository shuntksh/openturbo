/**
 * Help handler - displays CLI usage information.
 */

import type { ColorFn, Config } from "../mod";

export function handleHelp(config: Config | null, c: ColorFn): void {
	const jobs = config ? Object.keys(config.workflows) : [];

	console.log(`
${c("bold", "Job Runner")} - Generic workflow runner with Git worktree support

${c("dim", "USAGE:")}
  bun run .config/scripts/runner.ts --job <name> [options]

${c("dim", "OPTIONS:")}
  ${c("green", "-j, --job <name>")}   Job/workflow to run (required)
  ${c("green", "-c, --config <path>")} Path to config file
  ${c("green", "-v, --verbose")}      Show output for all steps
  ${c("green", "--fail-fast")}        Stop on first failure (default: true)
  ${c("green", "--graph")}            Show dependency graph and exit
  ${c("green", "--no-color")}         Disable colored output
  ${c("green", "-h, --help")}         Show this help message

${c("dim", "AVAILABLE JOBS:")}
${jobs.length > 0 ? jobs.map((j) => `  ${c("cyan", j)}`).join("\n") : "  (no config loaded)"}

${c("dim", "CONFIG DISCOVERY:")}
  1. --config <path> (explicit)
  2. {git_root}/workflow.json or .jsonc
  3. {git_root}/workflows.json or .jsonc
  4. {git_root}/.config/workflow.json or .jsonc
  5. {git_root}/.config/workflows.json or .jsonc
  6. {git_root}/package.json → "workflows" field

${c("dim", "BRANCH FILTERING:")}
  branches: ["main"]         Only run on main
  branches: ["!main"]        Run on all except main
  branches: ["feature-*"]    Glob matching
  branches: ["worktree:*"]   Only in git worktrees
`);
}
