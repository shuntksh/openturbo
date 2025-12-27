---
title: Step Types
description: Available step types in OpenTurbo workflows
---

OpenTurbo supports several types of steps to define your workflow.

## `cmd`

Run a shell command:

```json
{ "name": "build", "cmd": "bun run build" }
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
    "timeout": 30000
  }
}
```

### Dependency syntax

- `^task` — Run task in all dependencies first
- `task` — Run task in current package first
- `pkg#task` — Run specific package's task first
