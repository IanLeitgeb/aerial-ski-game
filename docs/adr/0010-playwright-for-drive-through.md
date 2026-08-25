# ADR-0010: Playwright for the real-browser drive-through

## Status
Accepted — 2026-08-24

## Context

The extraction is verified by three layers, all of which run against
`tests/babylon-stub.js` — a hand-written fake of the Babylon API:

- 68 unit and live-differential tests
- 30 golden-master traces
- 36 browser-suite assertions (run headlessly through the same stub)

That stub is good enough to have caught real defects, but it is **not Babylon**.
An entire class of bug is structurally invisible to it: anything where the stub's
behaviour diverges from the real engine. This is not hypothetical — the stub
originally returned identity from `Quaternion.multiply` and `RotationAxis`, and
its `eulerToQuat` did not match Babylon's convention. Both were found and fixed,
but only by inspection, not by any test.

Nothing currently runs `game.js` against **real** `lib/babylon.js`.

ADR-0006 records that the project deliberately has no bundler, no `package.json`
and no npm dependencies. That decision is about the SHIPPED game and remains
correct: `index.html` loads local files directly, and players receive static
files with no build step.

## Decision

Add Playwright as a **development-only** dependency to drive the real game in a
real headless Chromium against real Babylon.js.

The distinction that keeps ADR-0006 intact:

- **Shipped game** — still zero dependencies, zero build. `index.html` and the
  files it loads are exactly what is served.
- **Test tooling** — may have dependencies. `package.json` is marked `private`
  and carries only `devDependencies`; nothing it installs is ever served.

`node_modules/` is gitignored. A checkout without `npm install` can still run
everything except the drive-through, because the other three layers remain
dependency-free by design.

## What the drive-through is for

It answers a question the stub-based layers cannot:

1. Does the game actually boot in a real browser with real Babylon and the nine
   engine modules loading in order? A load-order mistake would break the browser
   while every headless test stayed green.
2. Does a full run play through — approach, charge, take-off, rotation, landing?
3. Are there console errors? `game.js` swallows exceptions into
   `console.error` (game.js:3204-4417), which the headless harness now captures;
   this confirms the same is true against real Babylon.

It is NOT a replacement for the golden traces. Traces are deterministic and
compare thousands of values; the drive-through is a smoke test against reality.
Both are needed for different reasons.

## Consequences

- Closes the "never runs against real Babylon" gap before merging to `main`.
- Adds ~150 MB (Chromium) to a dev checkout. Disk is not scarce here.
- `npm install` becomes a prerequisite for one test layer only.
- Introduces a `package.json` to a project that deliberately had none. The risk
  is that someone later reads this as licence to add runtime dependencies. The
  `description` field and this ADR exist to say plainly that it is not.
- CI, if added later, needs a Chromium download step.
