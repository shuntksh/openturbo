---
title: Step Types
description: Available step types in Ot workflows
---

Ot supports several types of steps to define your workflow.

## `cmd`

Run a shell command:

```json
{ "name": "build", "cmd": "bun run build" }
```

Ot uses `sh` on Unix. On Windows it detects and prefers PowerShell (`pwsh`,
then Windows PowerShell) and falls back to `cmd.exe`. Set
`OT_SHELL=auto|pwsh|powershell|cmd|sh|bash` to override detection. Commands use
the selected shell's native syntax. Shell scripts require an installed POSIX
shell with `OT_SHELL=sh` or `OT_SHELL=bash`.

`name` is the stable step id used by `dependsOn`. Add `displayName` when you want a friendlier label in progress output:

```json
{ "name": "typecheck", "displayName": "TypeScript", "cmd": "bun run typecheck" }
```

Append CLI-provided changed files to a command:

```json
{ "name": "lint", "cmd": "biome check", "changedFiles": "append" }
```

## `worktree:cp`

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

## `bun`

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

`changedFiles: "append"` appends package-scoped changed files to each package
script. `cache: true` enables local content-hash success caching for package
script invocations. Cache hits skip only when the script command, Bun version,
package inputs, relevant root inputs, and changed-file argv match a previous
successful run.

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

### Dependency syntax

- `^task` — Run task in all dependencies first
- `task` — Run task in current package first
- `pkg#task` — Run specific package's task first

## Nested `steps`

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
