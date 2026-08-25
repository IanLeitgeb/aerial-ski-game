# ADR-0009: Delegate to opencode subagents; Opus holds review authority

## Status
Accepted — 2026-08-24 (delegation model settled; `ox-alpha-free` unavailable, see below)

## Context
Bulk mechanical work — trace generation, differential test scaffolding, repetitive
extraction — does not require the strongest available model, but correctness
judgement on core physics does. A free, unmetered model is available locally via
`opencode`, making delegation economically attractive for high-volume work.

Measured on this host:
- `opencode` v1.18.22 at `~/.opencode/bin/opencode`; free `opencode/*` models work
  with **0 stored credentials**.
- Verified working: `opencode/big-pickle`, `opencode/x-preview-f-free`.
- Authenticated by writing `~/.local/share/opencode/auth.json` directly:
  `{"opencode":{"type":"api","key":"sk-..."}}`, mode 0600. The `auth login` TUI
  cannot run inside a tool call, and `OPENCODE_API_KEY` is **ignored** by
  `opencode run` (verified: a bogus value still let `big-pickle` succeed).
- The credential works — the model registry went from **7 models to 62** once it
  was present.
- **`ox-alpha-free` is still not in the CLI registry** and still returns
  `Unexpected server error`, despite "Ox Alpha Free" being enabled in the Zen
  console. The console and CLI registries disagree in both directions:
  `Laguna S 2.1 Free` is in the console but not the CLI, and
  `x-preview-f-free` is in the CLI but not the console — consistent with stealth
  models carrying rotating internal codenames.

## Decision
Delegate high-volume, verifiable work to opencode subagents. Agent definitions
live in `.opencode/agent/*.md` using the existing frontmatter convention already
present in `.github/agents/code-analyst.agent.md` (`name`, `description`, `tools`).

**Authority model — non-negotiable:**
- Subagents *propose*; they never merge, and never decide.
- Opus retains **review authority** over all core game-logic changes and
  **coordination/judgement authority** over sequencing and design.
- Every subagent output touching `engine/core/` is verified against ADR-0005
  golden traces before acceptance. Agreement between agents is not evidence;
  the traces are.

The model id is a single config value (`OPENCODE_MODEL`) so it can be repointed
without touching agent definitions.

**Current selection:** `opencode/x-preview-f-free` (free, stealth, verified
working) with `opencode/big-pickle` as fallback. Paid models
(`claude-haiku-4-5`, `gpt-5.4-mini`) are now reachable but are not used for bulk
work: delegated tasks are mechanical and every output touching `engine/core/` is
adjudicated by the ADR-0005 golden traces, not by model confidence.

## Consequences
- Bulk work parallelises at no token cost.
- A weaker model's errors are caught by traces and Opus review rather than shipped.
- Requires the discipline that delegation never implies delegated authority.
- `ox-alpha-free` remains unavailable via CLI. Not a blocker — repointing is a
  one-line config change if it appears. Worth retrying after an `opencode`
  upgrade, since the registry may be cached client-side.
