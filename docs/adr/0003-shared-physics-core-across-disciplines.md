# ADR-0003: Shared physics core across all disciplines

## Status
Accepted — 2026-08-24

## Context
The codebase already ships three sports behind URL-param mode flags
(`_worldParam`): aerial skiing (default), trampoline (`_trampolineMode`,
`_trampolineMatMode`) and pool diving (`_poolDiveMode`) — 31 mode-gated branches
in one file.

The airborne physics is genuinely identical across all three: a somersault is a
somersault. Rotation integration, moment of inertia as a function of tuck/pike,
arm-sweep kinematics, trick recognition and rotation-tolerance-at-contact do not
care whether the athlete left a kicker, a trampoline bed or a platform.

## Decision
Split into a shared core plus thin discipline modules.

**Shared (`engine/core/`)** — used by all three sports:
- rotation integration, angular momentum, `omega`
- `computeI` — tuck/pike → moment of inertia
- pose kinematics (`armSweep`, `computePose`)
- trick recognition and difficulty scoring structure (`matchTrick`, `calcDD`)
- landing/entry rotation validation

**Discipline-specific (`engine/disciplines/`)** — takeoff, terrain, landing
surface, scoring tables, gravity/drag constants:
- `aerial-ski.js` — `terrainRootY`, `terrainAccelZ`, kicker profile, `GRAVITY = 14.0`
- `trampoline.js` — bed restitution, mat mode
- `diving.js` — platform/springboard, water entry

Disciplines depend on core; core never imports a discipline.

## Consequences
- A physics fix benefits all three sports at once.
- Adding a fourth discipline is a config module, not a fork.
- Core changes can regress three games, so core carries the strictest test coverage.
- Some constants currently global (e.g. `GRAVITY`) must become per-discipline
  parameters, which is a behaviour-preserving but wide-reaching change.
