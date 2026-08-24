You are extracting the rotation integrator from a JavaScript game into a shared engine module. Output ONLY code, no prose, no markdown fences.

## The logic to extract

From `game.js` (around line 4039). `state.L_flip` is angular momentum, `I` is moment of inertia:

```js
        let omega = state.L_flip / I;
        if (_trampolineMode) omega = Math.min(omega, 13.0);
        // D key (trampoline): single flip — untucked = ~1 flip; full tuck/pike = 3×
        if (singleLayoutMode) {
            const boost = Math.max(state.tuckAmount, state.pikeAmount) * 2.0;
            omega = Math.min(omega, Math.PI * (1.0 + boost));
        }
        if (!state.grounded && !tramBouncing && !matTramBouncing) {
            const flipDirBoost = (state.flipDir === -1) ? 1.11 : 1.0; // frontflip ~11% faster
            state.flipAngle += omega * state.flipDir * flipDirBoost * dt;
            if (singleLayoutMode && !_trampolineMode) {
                state.flipAngle = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, state.flipAngle));
            }
        }
```

## Design

This is SHARED physics — aerial skiing, trampoline and diving all use it. The discipline-specific parts (the 13.0 rad/s trampoline cap, the single-layout clamp) must become CONFIGURATION passed in, not hardcoded branches, so the core does not know which sport it is running.

## Produce `engine/core/rotation.js`

Use EXACTLY this dual-mode pattern (the project has no bundler; the file must load via `require()` in Node, `<script>` in a browser, and `vm.runInContext` in the test harness):

```js
(function (global) {
'use strict';

// ... body ...

const api = { /* exports */ };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).rotation = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
```

Export exactly these three:

### `FRONTFLIP_BOOST` = 1.11
A frontflip rotates ~11% faster. Keep the original comment.

### `angularVelocity(L_flip, I, opts)`
`opts` is optional, defaulting to `{}`. Supported keys:
- `maxOmega` — a number. When present, the result is capped: `Math.min(omega, maxOmega)`. (Trampoline passes 13.0.)
- `singleLayout` — boolean. When true, additionally cap with
  `Math.min(omega, Math.PI * (1.0 + boost))` where
  `boost = Math.max(tuckAmount, pikeAmount) * 2.0`.
- `tuckAmount`, `pikeAmount` — numbers, default 0, used only for that boost.

Order of operations must match the original EXACTLY: divide first, then the
`maxOmega` cap, then the `singleLayout` cap.

### `integrateFlip(flipAngle, omega, flipDir, dt, opts)`
Returns the NEW flip angle. Must compute exactly:
`flipAngle + omega * flipDir * flipDirBoost * dt`
where `flipDirBoost` is `FRONTFLIP_BOOST` when `flipDir === -1`, else `1.0`.

`opts` optional. When `opts.clampToFullRotation` is true, clamp the result with
`Math.max(-Math.PI * 2, Math.min(Math.PI * 2, result))`.

This function must be PURE — it returns a number, it must not mutate anything.
The caller decides whether the athlete is airborne; do NOT put a grounded check
inside.

## Hard constraints

- Arithmetic and its ORDER must be byte-for-byte identical to the original.
  Do NOT algebraically rearrange. Do NOT precompute or factor out
  subexpressions. Floating-point multiplication is not associative, so
  `omega * flipDir * flipDirBoost * dt` must stay in that exact order.
- Keep the explanatory comments from the original.
- No BABYLON, no DOM, no localStorage, no require of anything.

Output format — exactly this, no other text:

===FILE: engine/core/rotation.js===
<contents>
