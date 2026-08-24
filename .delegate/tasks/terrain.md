You are extracting the aerial-ski terrain profile into a discipline module.

## Source, verbatim from game.js

```js
function _transBezY(z) {
    let lo = 0, hi = 1;
    for (let _i = 0; _i < 14; _i++) {
        const _m = (lo + hi) * 0.5, _u = 1 - _m;
        (_u*_u*_u*_tBP[0][0] + 3*_u*_u*_m*_tBP[1][0] + 3*_u*_m*_m*_tBP[2][0] + _m*_m*_m*_tBP[3][0] < z)
            ? (lo = _m) : (hi = _m);
    }
    const _t = (lo + hi) * 0.5, _u = 1 - _t;
    return _u*_u*_u*_tBP[0][1] + 3*_u*_u*_t*_tBP[1][1] + 3*_u*_t*_t*_tBP[2][1] + _t*_t*_t*_tBP[3][1];
}

function _kickerBezY(z) {
    let lo = 0, hi = 1;
    for (let _i = 0; _i < 14; _i++) {
        const _m = (lo + hi) * 0.5, _u = 1 - _m;
        (_u*_u*_u*_kBP[0][0] + 3*_u*_u*_m*_kBP[1][0] + 3*_u*_m*_m*_kBP[2][0] + _m*_m*_m*_kBP[3][0] < z)
            ? (lo = _m) : (hi = _m);
    }
    const _t = (lo + hi) * 0.5, _u = 1 - _t;
    return _u*_u*_u*_kBP[0][1] + 3*_u*_u*_t*_kBP[1][1] + 3*_u*_t*_t*_kBP[2][1] + _t*_t*_t*_kBP[3][1];
}

function terrainRootY(z) {
    if (_trampolineMode) return TRAMPOLINE_Y;
    if (_trampolineMatMode) {
        // Crash mat surface is 0.28m above gym floor; translate to rootY threshold
        if (z >= MAT_LAND_START_Z && z <= MAT_LAND_END_Z) return TRAMPOLINE_Y + 0.28 + 0.10;
        return TRAMPOLINE_Y;
    }
    if (z < SLOPE_START_Z) return -SLOPE_START_Z * Math.tan(SLOPE_ANGLE); // flat top
    const tableY = -FLAT_Z * Math.tan(SLOPE_ANGLE); // y-height of the flat table
    if (z < TRANS_START_Z) return -z * Math.tan(SLOPE_ANGLE); // straight inrun slope
    // ── Cubic bezier transition: slope angle → flat, 3m before + 3m after FLAT_Z ──
    if (z < TRANS_END_Z) return _transBezY(z);
    // ── Flat table (TRANS_END_Z → KICKER_START_Z) ────────────────────────────────
    if (z <= KICKER_START_Z) return tableY;
    // ── Kicker: pure convex bezier KICKER_START_Z (flat) → KICKER_END_Z (lip angle) ──
    // P0/P1 both at tableY → zero entry tangent → mathematically cannot dip below table.
    if (z <= KICKER_END_Z) return _kickerBezY(z);
    const _backFaceEndZ   = KICKER_END_Z + 0.5;
    const _landingStartZ  = LANDING_START_Z;
    // Landing: flat at tableY then simple straight slope downward
    if (z <= _landingStartZ) return tableY;
    if (z <= OUTRUN_Z) return tableY - (z - _landingStartZ) * Math.tan(LANDING_ANGLE);
    return tableY - (OUTRUN_Z - _landingStartZ) * Math.tan(LANDING_ANGLE); // flat outrun
}

function terrainAccelZ(z) {
    if (_trampolineMode || _trampolineMatMode || _poolDiveMode) return 0;
    const g = 14.0;
    if (z < SLOPE_START_Z) return 0;    // flat top
    if (z > OUTRUN_Z)      return -14.0; // flat outrun friction
    // Derive along-slope acceleration from terrain gradient.
    // accZ = -g * sin(θ) = -g * (dy/dz) / sqrt(1 + (dy/dz)²)
    // Works continuously across slope, transition, kicker, and landing.
    const eps  = 0.01;
    const dydz = (terrainRootY(z + eps) - terrainRootY(z - eps)) / (2 * eps);
    return -g * dydz / Math.sqrt(1 + dydz * dydz);
}
```

## The constants these read

They are computed at runtime from URL parameters, so they CANNOT be hardcoded.
They must arrive in a config object:

```
SLOPE_ANGLE, SLOPE_START_Z, FLAT_Z, TRANS_START_Z, TRANS_END_Z,
KICKER_START_Z, KICKER_END_Z, LANDING_START_Z, OUTRUN_Z, LANDING_ANGLE,
MAT_LAND_START_Z, MAT_LAND_END_Z, TRAMPOLINE_Y
```

`_transBezY` and `_kickerBezY` additionally read the bezier control-point arrays
`_tBP` and `_kBP`. Those also come from config.

The functions also branch on `_trampolineMode`, `_trampolineMatMode` and
`_poolDiveMode`. Per ADR-0003 the discipline must NOT be a branch inside shared
code — but these four functions are aerial-ski-SPECIFIC, so instead take a
`mode` field on the config with value `'ski'`, `'trampoline'`, `'trampolineMat'`
or `'pool'`, and branch on that. Do not read any global.

## Produce `engine/disciplines/aerial-ski.js`

Namespace: `aerialSki`.

Export: `terrainRootY(z, cfg)`, `terrainAccelZ(z, cfg)`,
`transBezY(z, cfg)`, `kickerBezY(z, cfg)`.

Every function takes the config as its LAST parameter. Inside, read values off
`cfg` (e.g. `cfg.SLOPE_ANGLE`, `cfg.mode`, `cfg.tBP`, `cfg.kBP`). Rename the
bezier arrays to `cfg.tBP` / `cfg.kBP` but change NOTHING about the maths.

Where the original called `_transBezY(z)` / `_kickerBezY(z)` internally, call
`transBezY(z, cfg)` / `kickerBezY(z, cfg)`.

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

===FILE: engine/disciplines/aerial-ski.js===
<contents>
