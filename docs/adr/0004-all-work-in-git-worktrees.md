# ADR-0004: All project work happens in git worktrees

## Status
Accepted — 2026-08-24

## Context
`main` is the branch actually served to players (GitHub Pages, and the local
`python3 -m http.server`). There is no CI gate — the repo's only `.github`
content is an agent definition, no workflow. Upcoming work (engine extraction,
asset pipeline, renderer trials) is exploratory and may be abandoned.

A concrete hazard was observed: `game.js` on `main` routinely carries the
author's own uncommitted tuning experiments. A careless `git checkout game.js`
during a revert would have destroyed unpushed work.

## Decision
All project work happens in a git worktree under `.claude/worktrees/`, never
directly on `main`. The coordinator names worktrees to avoid overlap.

Corollary: to revert changes inside a worktree, restore from a file copy — never
`git checkout` a file that may carry unrelated uncommitted work.

## Consequences
- `main` stays continuously playable.
- Abandoned experiments cost a directory deletion, nothing more.
- Multiple lines of work proceed in parallel without interference.
- Slight disk overhead per worktree; negligible at this repo's 9.4 MB.
