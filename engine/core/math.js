(function (global) {
'use strict';
// ── Shared math core ─────────────────────────────────────────────────────────
// Dual-mode by necessity, not preference. This one file has to load three ways:
//   1. `require()` from node --test               → module.exports
//   2. <script> in index.html / tests/test.html   → global namespace
//   3. vm.runInContext in the headless harness    → global namespace
// The project has no bundler and no package.json by design (ADR-0006), so a
// build step to reconcile those is not an option.

const TWO_PI = Math.PI * 2;

function lerp(a, b, t) { return a + (b - a) * t; }

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeAngle(a) {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

const api = { lerp, clamp, normalizeAngle, TWO_PI };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).math = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
