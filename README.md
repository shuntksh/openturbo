<p align="center">
  <h1 align="center">OpenTurbo(WIP)</h1>
  <p align="center">
    <strong>TurboRepo-style task runner for Bun</strong>
    <br />
    <em>Lightweight, zero-dependency task runner with Git worktree awareness</em>
  </p>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#usage">Usage</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#step-types">Step Types</a> •
  <a href="#branch-filtering">Branch Filtering</a>
</p>

`OpenTurbo` is a high-performance task runner designed for Bun. It brings TurboRepo-style parallel execution and dependency graph awareness to any project, with first-class support for Git worktrees and branch-conditional tasks.

---
![OpenTurbo demo](doc/demo.gif)

## Features

- **Branch-filtered steps**: Run steps conditionally based on branch patterns with glob and negation support
- **Git worktree support**: Copy files between worktrees, branch-specific filtering for worktree contexts
- **Workspace-aware execution**: Parallel NPM script execution across npm/bun workspaces with dependency ordering
- **Dependency graph**: Define step dependencies with `dependsOn` for sequential or parallel execution

## Installation

Currently, you can install OpenTurbo from source using `bun add`:

```sh
bun add -D github:shuntksh/openturbo
```

## Usage

```sh
bun run src/cmd.ts <job-name> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-j, --job <name>` | Job name to run (can also be positional) |
| `-c, --config <path>` | Custom config file path |
| `--graph` | Print execution graph without running |
| `--fail-fast` | Stop on first failure (default: true) |
| `-v, --verbose` | Show command output |
| `--no-color` | Disable colored output |
| `-h, --help` | Show help |

## Configuration

Config is discovered from (in order):

1. Custom path via `--config`
2. `workflow.json` or `workflow.jsonc` in git root
3. `.config/workflow.json` or `.config/workflow.jsonc`
4. `workflows` field in `package.json`

### Example

```jsonc - package.json
{
  "workflows": {
    "build": {
      "steps": [
        { "name": "install", "cmd": "bun install --frozen-lockfile" },
        { "name": "build", "bun": { "script": "build" }, "dependsOn": ["install"] }
      ]
    },
    "sync-config": {
      "steps": [
        {
          "name": "copy-from-main",
          "branches": ["worktree:*", "!main"],
          "worktree:cp": {
            "from": "worktree:main",
            "files": [".config/settings..json",".env"],
            "allowMissing": true
          }
        }
      ]
    },
    "test-all": {
      "steps": [
        {
          "name": "test",
          "bun": {
            "script": "test",
            "dependsOn": ["^build"],
            "timeout": 60000
          }
        }
      ]
    }
  }
}
```

## Step Types

### `cmd`

Run a shell command:

```json
{ "name": "build", "cmd": "bun run build" }
```

### `worktree:cp`

Copy files from another worktree:

```json
{
  "name": "sync",
  "worktree:cp": {
    "from": "main",
    "files": ["config.json", "secrets/"],
    "allowMissing": true
  }
}
```

### `bun`

Run scripts across workspace packages with dependency ordering (TurboRepo-style):

```json
{
  "name": "test",
  "bun": {
    "script": "test",
    "dependsOn": ["^build"],
    "timeout": 30000
  }
}
```

**Dependency syntax:**
- `^task` — Run task in all dependencies first
- `task` — Run task in current package first
- `pkg#task` — Run specific package's task first

## Branch Filtering

Steps can be filtered by branch using glob patterns:

```json
{ "name": "deploy", "branches": ["main", "release-*"] }
```

**Pattern syntax:**
- `*` — Matches any characters
- `!pattern` — Negation (exclude matching branches)
- `worktree:*` — Only run in worktree contexts

## License

MIT
