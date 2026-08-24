# ADR-0005: Golden-master traces captured before refactoring

## Status
Accepted — 2026-08-24

## Context
The single most valuable asset in this codebase is the *feel* of the aerial
physics — arm-drop timing, spin coupling, flip power — tuned by hand over months.
It is not specified anywhere; it exists only as the behaviour of the current code.
Recent history shows the area is delicate: `0e05f72` reverts a spin fix that
looked correct but felt wrong.

A refactor of this code cannot be validated by reading it. "Looks equivalent" is
exactly the failure mode that loses months of tuning.

## Decision
Before **any** extraction work begins, capture deterministic golden-master traces
from the current implementation: fixed input sequences replayed at a fixed
timestep, recording full simulation state every frame to JSON.

The refactored engine must reproduce these traces within a tight epsilon. This is
the acceptance test for the entire extraction.

Traces are captured from **committed HEAD (`0e05f72`)**, not the working tree.
At time of writing the working tree held in-progress spin tuning
(`SPIN_SPEED * 3.0 → 9.0`, coupling `0.3 → 1.1`); locking a mid-experiment
constant into the baseline would enshrine a value still being dialled in.

Required coverage: full-twisting double, single frontflip (`flipDirBoost` path),
under-rotated landing, over-rotated landing, pike sequence, each gamepad arm-drop
path, plus trampoline and diving equivalents.

## Consequences
- Refactor correctness becomes a numeric pass/fail, not a judgement call.
- Traces double as the acceptance test for any future engine port.
- Deliberate feel changes require regenerating traces — an explicit, visible act,
  which is the desired friction.
- Upfront cost before any restructuring value is delivered. Accepted.
