You are extracting landing validation and execution scoring into a shared engine module.

## Source, verbatim from game.js

Landing window check:

```js
                const TWO_PI  = Math.PI * 2;
                const norm    = ((state.flipAngle % TWO_PI) + TWO_PI) % TWO_PI;
                const LAND_TOL = Math.PI / 4; // 45° — clean landing window
                const feetDown = (norm < LAND_TOL || norm > TWO_PI - LAND_TOL);
```

Execution score, computed from the same `norm`:

```js
                    // ── Execution score ──────────────────────────────────────
                    // Forward lean (norm in [0, LAND_TOL]) scores highest — max forward = 30, upright = 15.
                    // Backward lean (norm in (TWO_PI-LAND_TOL, TWO_PI]) scores lowest — max backward = 0.
                    let execRaw;
                    if (norm <= LAND_TOL) {
                        // Forward lean: norm=0 (upright) → 29, norm=LAND_TOL (max forward) → 30
                        const fwd = norm / LAND_TOL;
                        execRaw = 29 + 1 * fwd;
                    } else {
                        // Backward lean: norm=TWO_PI-LAND_TOL (max backward) → 25, norm near TWO_PI (nearly upright) → 29
                        const bwd = (norm - (TWO_PI - LAND_TOL)) / LAND_TOL;
                        execRaw = 25 + 4 * bwd;
                    }
                    state.execution = Math.max(0, Math.round(execRaw * 10) / 10);
```

And the signed lean derived from it:

```js
                    const _signedLean = norm < Math.PI ? norm : norm - TWO_PI;
```

## Produce `engine/core/landing.js`

Namespace: `landing`. Depends on `math` for `normalizeAngle` and `TWO_PI` —
use them rather than recomputing, but ONLY if `normalizeAngle` is exactly
`((a % TWO_PI) + TWO_PI) % TWO_PI`. It is.

Export:
- `DEFAULT_LAND_TOL` = `Math.PI / 4`  (45°, the clean landing window)
- `isFeetDown(flipAngle, landTol)` — `landTol` optional, defaults to
  DEFAULT_LAND_TOL. Returns the boolean, computed from the normalised angle
  exactly as the original does.
- `executionScore(flipAngle, landTol)` — returns the final rounded number
  (`Math.max(0, Math.round(execRaw * 10) / 10)`), same branch structure.
- `signedLean(flipAngle)` — returns `norm < Math.PI ? norm : norm - TWO_PI`.

All PURE — take an angle, return a value. No `state`, no mutation.

This is SHARED: aerial ski, trampoline and diving all validate rotation at
contact the same way; only the tolerance differs, which is why it is a parameter.

Use EXACTLY this dual-mode wrapper (the project has no bundler; the file must load
via require() in Node, <script> in a browser, and vm.runInContext in the harness):

```js
(function (global) {
'use strict';

// ... body ...

const api = { /* exports */ };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).NAMESPACE = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
```

For a dependency on another engine module (there is no `require` in a browser):

```js
const _math = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports)
    ? require('./math.js')
    : global.AerialEngine.math;
```

HARD CONSTRAINTS (these apply to every task):
- Arithmetic and its ORDER must be byte-for-byte identical to the original.
  Do NOT algebraically rearrange, do NOT factor out repeated subexpressions,
  do NOT change `x*x` to `x**2`. Floating-point maths is not associative.
- Keep every explanatory comment.
- No BABYLON, no DOM, no localStorage, no window.
- Output ONLY code. No prose, no markdown fences.

Output format — exactly this, no other text:

===FILE: engine/core/landing.js===
<contents>
