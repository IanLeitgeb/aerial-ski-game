# ADR-0006: `node --test` runner; green suite gates merge to main

## Status
Accepted — 2026-08-24

## Context
The project deliberately has no bundler, no `package.json`, and no npm
dependencies — it ships as static files served directly. Node v22.22.1 is
available locally.

Existing tests: `tests/test.html`, ~58 assertions run in a browser, backed by
`tests/babylon-stub.js`. They cover `lerp`, `computeI`, `terrainRootY`,
`terrainAccelZ`, `armSweep`, the power-meter formula and initial game state,
including explicit regression tests.

## Decision
Use Node's built-in `node --test` for unit tests of the extracted pure core.
Zero dependencies, no `package.json` required, consistent with the project's
no-build philosophy.

Keep `tests/test.html` as the browser-level integration suite. It is not
replaced — it validates the renderer boundary that `node --test` deliberately
cannot reach.

**The full suite must pass before anything merges to `main`.** No CI enforces
this; it is a manual gate that must be checked deliberately every time. Never
merge on a red or unrun suite — if tests are broken for unrelated reasons,
surface that and let the author decide.

## Consequences
- Unit tests run in milliseconds with no install step.
- Two runners to invoke (`node --test` and the browser page) until integration
  tests can be automated headlessly.
- The manual gate depends on discipline; adding CI later would strengthen it.
