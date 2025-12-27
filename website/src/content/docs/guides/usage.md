---
title: Usage
description: Basic usage of OpenTurbo CLI
---

Run a job defined in your workflow configuration:

```sh
ot <job-name> [options]
```

## Options

| Flag | Description |
|------|-------------|
| `-j, --job <name>` | Job name to run (can also be positional) |
| `-c, --config <path>` | Custom config file path |
| `--graph` | Print execution graph without running |
| `--fail-fast` | Stop on first failure (default: true) |
| `-v, --verbose` | Show command output |
| `--no-color` | Disable colored output |
| `-h, --help` | Show help |

## Worktree Management

You can also manage worktrees directly from the CLI:

```sh
ot wt <command> [options]
```

| Command | Description |
|---------|-------------|
| `add` | Create a new worktree (and optionally a new branch) |
| `remove` | Remove a worktree (and optionally delete its branch) |
| `list` | List managed worktrees |

See the [Worktree Management](/openturbo/guides/worktree-management/) guide for more details.
