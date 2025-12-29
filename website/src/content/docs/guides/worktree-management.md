---
title: Worktree Management
description: Managing Git worktrees with OpenTurbo
---

OpenTurbo replaces `git worktree` boilerplate with a streamlined CLI that handles directory management and setup hooks.

## Commands

### List worktrees

```bash
ot wt list
```

### Add a worktree

```bash
# Add worktree for existing branch
ot wt add feature/login

# Create new branch and worktree
ot wt add -b feature/new-ui

# Add with custom base
ot wt add -b fix/bug --base v1.2.0
```

### Remove a worktree

```bash
# Remove worktree directory only
ot wt remove feature/login

# Remove worktree and delete the branch
ot wt remove --with-branch feature/login
```

### Copy files between worktrees

```bash
# Copy from main to current worktree
ot wt cp main@.env .env

# Copy to main from current worktree
ot wt cp .env main@.env

# Copy with glob patterns (preserves directory structure)
ot wt cp main@./packages/**/dist .
```

Path spec format: `[branch]@<path>`. If no branch is specified, the current worktree is used.
