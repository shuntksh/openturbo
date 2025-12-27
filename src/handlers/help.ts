/**
 * Help handler - displays CLI usage information.
 */

import type { ColorFn, Config } from "../mod";

export function handleHelp(config: Config | null, c: ColorFn): void {
	const jobs = config ? Object.keys(config.workflows) : [];

	console.log(`
${c("bold", "Job Runner")} - Generic workflow runner with Git worktree support

${c("dim", "USAGE:")}
  bun run .config/scripts/runner.ts [job] [options]

${c("dim", "OPTIONS:")}
  ${c("green", "-j, --job <name>")}   Job/workflow to run (optional if positional)
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
  2. Search from CWD up to git root:
     a. workflow.json or .jsonc
     b. workflows.json or .jsonc
     c. package.json → "workflows" field
  3. At git root:
     a. .config/workflow.json or .jsonc
     b. .config/workflows.json or .jsonc

${c("dim", "BRANCH FILTERING:")}
  branches: ["main"]         Only run on main
  branches: ["!main"]        Run on all except main
  branches: ["feature-*"]    Glob matching
  branches: ["worktree:*"]   Only in git worktrees
`);
}
