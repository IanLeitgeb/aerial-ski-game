# ADR-0002: Separate game logic from display logic

## Status
Accepted — 2026-08-24

## Context
`game.js` is 4,419 lines mixing simulation, rules, input and Babylon.js rendering.
Measured coupling: **341 of 4,419 lines (7.7%) reference `BABYLON.*`** — the
simulation is *almost* independent already, but not cleanly separable.

The strongest evidence is `tests/babylon-stub.js`: an 11 KB hand-written fake of
the Babylon API whose only purpose is to let `game.js` initialise so logic can be
tested at all. **The stub is a symptom, not a solution** — it exists because pure
math is trapped behind a renderer.

Concrete violations found:
- `applyPose(meshes, tuck, armDropL, ...)` (`game.js:486`) takes meshes and mutates them.
- `applyGamepadLateral(meshes, lx, rx, ...)` (`game.js:621`) — same.

## Decision
Game logic lives in `engine/` as pure functions: `(state, input, dt) → newState`.
No `BABYLON.*`, no `document`, no `window` may appear under `engine/`.
Rendering lives in `render/` and *reads* engine state to drive meshes.

`applyPose` becomes `computePose(state) → { jointName: angle }`; the renderer
applies the returned angles to meshes.

## Consequences
- Physics becomes testable in `node --test` with **no stub at all**. This is the
  measurable success criterion for the extraction.
- A renderer or engine swap touches only `render/`.
- One-time refactoring cost, and a discipline to maintain: a `BABYLON.` reference
  appearing under `engine/` is a build-breaking error (enforced by a test).
