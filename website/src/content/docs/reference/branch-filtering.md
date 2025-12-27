---
title: Branch Filtering
description: Conditional execution based on git branches
---

Steps can be filtered by branch using glob patterns. This is useful for running certain steps only on specific branches, like deploying only from `main` or syncing config only in worktrees.

```json
{ "name": "deploy", "branches": ["main", "release-*"] }
```

## Pattern syntax

- `*` — Matches any characters
- `!pattern` — Negation (exclude matching branches)
- `worktree:*` — Only run in worktree contexts
