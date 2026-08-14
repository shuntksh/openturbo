<p align="center">
  <h1 align="center">ot(WIP)</h1>
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
  <a href="#worktree-management">Worktree Management</a> •
  <a href="#step-types">Step Types</a> •
  <a href="#branch-filtering">Branch Filtering</a>
</p>

`ot` is a high-performance task runner designed for Bun. It brings TurboRepo-style parallel execution, nested step groups, and dependency graph awareness to any project, with first-class support for Git worktrees and branch-conditional tasks.

---
![ot demo](website/public/demo.gif)

## Features

- **Worktree Management**: Full lifecycle management (add, remove, list) with support for post-creation hooks
- **Branch-filtered steps**: Run steps conditionally based on branch patterns with glob and negation support
- **Git worktree support**: Copy files between worktrees, branch-specific filtering for worktree contexts
- **Workspace-aware execution**: Parallel NPM script execution across npm/bun workspaces with dependency ordering
- **Nested step groups**: Group related substeps and display nested progress under the parent step
- **Dependency graph**: Define top-level and nested step dependencies with `dependsOn` for sequential or parallel execution

## Installation

Currently, you can install Ot from source using `bun add`:

```sh
bun add -D github:shuntksh/ot
```

## Usage

```sh
ot <job-name> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-j, --job <name>` | Job name to run (can also be positional) |
| `-c, --config <path>` | Custom config file path |
| `--graph` | Print execution graph without running |
| `--changed-files [files...]` | Consume remaining args as changed files for hook integrations |
| `--changed-file <path>` | Add one changed file (repeatable) |
| `--fail-fast` | Stop on first failure (default: true) |
| `-v, --verbose` | Show command output |
| `--no-color` | Disable colored output |
| `--version` | Show version |
| `-h, --help` | Show help |

### Worktree Management

```sh
ot wt <command> [options]
```

| Command | Description |
|---------|-------------|
| `add` | Create a new worktree (and optionally a new branch) |
| `remove` | Remove a worktree (and optionally delete its branch) |
| `list` | List managed worktrees |
| `cp` | Copy files between worktrees |


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
        { "name": "install", "displayName": "Install dependencies", "cmd": "bun install --frozen-lockfile" },
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
            "hardTimeoutSeconds": 60
          }
        }
      ]
    },
    "quality": {
      "steps": [
        {
          "name": "checks",
          "description": "Run local checks",
          "parallel": false,
          "steps": [
            { "name": "format", "cmd": "bun run format" },
            { "name": "lint", "cmd": "bun run lint", "dependsOn": ["format"] },
            { "name": "test", "cmd": "bun test", "dependsOn": ["lint"] }
          ]
        }
      ]
    }
  }
}
```

### Lefthook Integration

Ot is designed to work with Lefthook's file templates. Put the Ot command in
`lefthook.yml` and pass Lefthook's expanded file list after `--changed-files`:

```yaml
# lefthook.yml
pre-commit:
  commands:
    lint:
      glob: "*.{js,jsx,ts,tsx,json,jsonc,md,css}"
      run: ot pre-commit --changed-files {staged_files}

pre-push:
  commands:
    test:
      run: ot pre-push --changed-files {push_files}
```

`--changed-files` consumes the remaining command-line arguments, which is
friendly to Lefthook templates such as `{staged_files}`, `{push_files}`, and
`{files}`. If a caller cannot append a list, it can pass repeatable
`--changed-file <path>` flags instead.

Then define matching Ot jobs:

```jsonc
{
  "workflows": {
    "pre-commit": {
      "steps": [
        {
          "name": "lint",
          "cmd": "biome check --write",
          "changedFiles": "append"
        }
      ]
    },
    "pre-push": {
      "steps": [
        {
          "name": "test",
          "bun": {
            "script": "test",
            "changedFiles": "append",
            "cache": true
          }
        }
      ]
    }
  }
}
```

Changed files are always available to child commands through environment
variables:

- `OT_CHANGED_FILES` newline-delimited paths
- `OT_CHANGED_FILES_JSON` JSON array
- `OT_CHANGED_FILES_COUNT` count

Set `changedFiles: "append"` when the underlying tool expects file paths as
argv. For `cmd` steps, Ot appends the root-relative changed files to the shell
command. For workspace `bun` steps, Ot scopes the list per package and rewrites
paths relative to each package cwd, so `packages/app/src/a.ts` becomes
`src/a.ts` when running inside `packages/app`.

When `bun.cache` is enabled, repeated hook runs skip package scripts that have
already succeeded with the same content hash. The cache key includes package
inputs, relevant root config and lock files, the package script command, Bun
version, action settings, and the changed-file argv. Cache files are written to
`.ot/cache` and ignored by git.

### Worktree Configuration

Configure worktree defaults and hooks in the `worktree` section of your config:

```jsonc
{
  "worktree": {
    "defaults": {
      "base_dir": "../worktrees" // Relative to git root
    },
    "hooks": {
      "post_create": [
        {
          "type": "copy",
          "from": ".env",
          "to": ".env"
        },
        {
          "type": "command",
          "command": "bun install"
        }
      ]
    }
  }
}
```

## Worktree Management

Ot replaces `git worktree` boilerplate with a streamlined CLI that handles directory management and setup hooks.

### Commands

**List worktrees**
```bash
ot wt list
```

**Add a worktree**
```bash
# Add worktree for existing branch
ot wt add feature/login

# Create new branch and worktree
ot wt add -b feature/new-ui

# Add with custom base
ot wt add -b fix/bug --base v1.2.0
```

**Remove a worktree**
```bash
# Remove worktree directory only
ot wt remove feature/login

# Remove worktree and delete the branch
ot wt remove --with-branch feature/login
```

**Copy files between worktrees**
```bash
# Copy from main to current worktree
ot wt cp main@.env .env

# Copy to main from current worktree
ot wt cp .env main@.env

# Copy with glob patterns (preserves directory structure)
ot wt cp main@./packages/**/dist .
```


## Step Types

### `cmd`

Run a shell command:

```json
{ "name": "build", "cmd": "bun run build" }
```

Ot uses `sh` on Unix. On Windows it detects and prefers PowerShell (`pwsh`,
then Windows PowerShell) and falls back to `cmd.exe`. Override detection with
`OT_SHELL=auto|pwsh|powershell|cmd|sh|bash`. Commands use the selected shell's
native syntax; a `.sh` script requires `OT_SHELL=sh` or `OT_SHELL=bash` and an
installed POSIX shell. If the requested shell is unavailable, Ot reports how
to select or install a compatible shell.

Append CLI-provided changed files to a command:

```json
{ "name": "lint", "cmd": "biome check", "changedFiles": "append" }
```

`name` is the stable step id used by `dependsOn`. Add `displayName` when you want a friendlier label in progress output:

```json
{ "name": "typecheck", "displayName": "TypeScript", "cmd": "bun run typecheck" }
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
    "parallel": 5,
    "hardTimeoutSeconds": 30,
    "cache": true
  }
}
```

`hardTimeoutSeconds` is optional. When set, Ot kills the package script if it
runs longer than the configured number of seconds.

Workspace `bun` steps run up to 5 package scripts concurrently per dependency
layer by default. Set `parallel` to control that limit:

```json
{
  "name": "lint",
  "bun": {
    "script": "lint",
    "parallel": 2
  }
}
```

Use `parallel: false` to run package scripts one at a time. Use `parallel: -1`
to run every ready package script in the current dependency layer at once.
`parallel: true` and an omitted value both use the default limit of 5.
`pararell` is also accepted as a compatibility alias.

`cache` is optional and disabled by default. Use `cache: true` or an object with
`inputs` and `globalInputs` globs to enable local content-hash success caching
for package script invocations.

```json
{
  "name": "lint",
  "bun": {
    "script": "lint",
    "changedFiles": "append",
    "cache": {
      "inputs": ["src/**/*", "package.json"],
      "globalInputs": ["biome.jsonc"]
    }
  }
}
```

#### Cache semantics

The Bun cache is local and success-only. Ot writes a cache entry only after a
package script exits successfully. Failed scripts, timed-out scripts, and killed
scripts are never cached.

Each package task gets its own cache key. A cache hit skips only that package
task; other packages in the same workflow can still run if their keys changed.
The key includes:

- the package name and package path
- the script name and package.json script command
- the Bun version
- cache-relevant action settings, including `dependsOn`, timeout settings, and
  whether changed files are appended
- package input file contents
- root/global input file contents
- changed-file argv for that package when `changedFiles: "append"` is used

With `cache: true`, package inputs default to all git-tracked, modified, and
untracked non-ignored files inside the package. Root/global inputs include common
lock files and config files such as `package.json`, `bun.lock`, `workflows.json`,
`biome.jsonc`, `tsconfig.json`, and common test/lint config names.

Use object form to narrow package inputs or add project-specific global inputs:

```json
{
  "name": "lint",
  "bun": {
    "script": "lint",
    "cache": {
      "inputs": ["src/**/*", "package.json"],
      "globalInputs": ["eslint.config.js", "tool.config"]
    }
  }
}
```

Cache entries are stored under `.ot/cache` and should not be committed.

**Dependency syntax:**
- `^task` — Run task in all dependencies first
- `task` — Run task in current package first
- `pkg#task` — Run specific package's task first

### Nested `steps`

Group related substeps under a parent step:

```json
{
  "name": "quality",
  "description": "Run quality checks",
  "parallel": false,
  "steps": [
    { "name": "format", "cmd": "bun run format" },
    { "name": "lint", "cmd": "bun run lint" },
    { "name": "test", "cmd": "bun test", "dependsOn": ["lint"] }
  ]
}
```

Nested steps display their progress under the parent step. Ready substeps run in
parallel by default. Set `parallel: false` to run one ready child at a time in
the order from `steps`, while still honoring `dependsOn`. `pararell` is also
accepted as a compatibility alias.

Outside the parent group, address a nested step as `parent.child`:

```json
{ "name": "package", "cmd": "bun build", "dependsOn": ["quality.test"] }
```

Inside a nested group, unqualified dependency names first resolve to sibling
substeps. If a child depends on a top-level step or another group, Ot promotes
that dependency to the parent group so the full group waits before running.

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
