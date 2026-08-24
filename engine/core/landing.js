(function (global) {
'use strict';
// ── Shared landing validation & execution scoring ────────────────────────────
// Extracted mechanically from game.js. Aerial skiing, trampoline and diving
// all validate rotation at contact the same way — only the tolerance differs,
// which is why it is a parameter. All functions are PURE: take an angle,
// return a value. No state, no mutation.
//
// Dual-mode by necessity, not preference. This one file has to load three ways:
//   1. `require()` from node --test               → module.exports
//   2. <script> in index.html / tests/test.html   → global namespace
//   3. vm.runInContext in the headless harness    → global namespace
// The project has no bundler and no package.json by design (ADR-0006).

const _math = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports)
    ? require('./math.js')
    : global.AerialEngine.math;

const { normalizeAngle, TWO_PI } = _math;

const DEFAULT_LAND_TOL = Math.PI / 4; // 45° — clean landing window

function isFeetDown(flipAngle, landTol) {
    const LAND_TOL = (landTol === undefined) ? DEFAULT_LAND_TOL : landTol;
    const norm     = normalizeAngle(flipAngle);
    return (norm < LAND_TOL || norm > TWO_PI - LAND_TOL);
}

function executionScore(flipAngle, landTol) {
    const LAND_TOL = (landTol === undefined) ? DEFAULT_LAND_TOL : landTol;
    const norm     = normalizeAngle(flipAngle);
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
    return Math.max(0, Math.round(execRaw * 10) / 10);
}

function signedLean(flipAngle) {
    const norm = normalizeAngle(flipAngle);
    return norm < Math.PI ? norm : norm - TWO_PI;
}

const api = { DEFAULT_LAND_TOL, isFeetDown, executionScore, signedLean };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).landing = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
