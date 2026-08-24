(function (global) {
'use strict';
// ── Shared rotation integrator ───────────────────────────────────────────────
// Dual-mode by necessity, not preference. This one file has to load three ways:
//   1. `require()` from node --test               → module.exports
//   2. <script> in index.html / tests/test.html   → global namespace
//   3. vm.runInContext in the headless harness    → global namespace
//
// Aerial skiing, trampoline and diving all run this same physics. The
// discipline-specific bits (the 13.0 rad/s trampoline cap, the single-layout
// clamp) are CONFIGURATION passed by the caller via `opts` — the core never
// knows which sport it is running.

// frontflip ~11% faster
const FRONTFLIP_BOOST = 1.11;

// Angular velocity ω from angular momentum L_flip over moment of inertia I.
// opts.maxOmega    — hard ceiling on ω (trampoline passes 13.0; ski omits it)
// opts.singleLayout — additionally cap at π·(1 + boost), untucked = ~1 flip,
//                     full tuck/pike = 3×
// opts.tuckAmount / opts.pikeAmount — feed that boost (default 0)
function angularVelocity(L_flip, I, opts) {
    const o = opts || {};
    let omega = L_flip / I;
    if (typeof o.maxOmega === 'number') {
        omega = Math.min(omega, o.maxOmega);
    }
    if (o.singleLayout) {
        const boost = Math.max(o.tuckAmount || 0, o.pikeAmount || 0) * 2.0;
        omega = Math.min(omega, Math.PI * (1.0 + boost));
    }
    return omega;
}

// Advance a flip angle by one step. PURE: returns the new angle and mutates
// nothing — the caller decides whether the athlete is airborne.
// opts.clampToFullRotation — clamp result to [-2π, +2π]
function integrateFlip(flipAngle, omega, flipDir, dt, opts) {
    const o = opts || {};
    const flipDirBoost = (flipDir === -1) ? FRONTFLIP_BOOST : 1.0;
    let result = flipAngle + omega * flipDir * flipDirBoost * dt;
    if (o.clampToFullRotation) {
        result = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, result));
    }
    return result;
}

const api = { FRONTFLIP_BOOST, angularVelocity, integrateFlip };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).rotation = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
