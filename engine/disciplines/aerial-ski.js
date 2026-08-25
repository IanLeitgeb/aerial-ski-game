(function (global) {
'use strict';
// ── aerial-ski terrain discipline ────────────────────────────────────────────
// Extracted verbatim from game.js. All geometry constants arrive at runtime in
// `cfg` (they are computed from URL parameters and cannot be hardcoded).
// Mode selection rides on cfg.mode ('ski' | 'trampoline' | 'trampolineMat' |
// 'pool') per ADR-0003: no shared-code branching on discipline globals.

function transBezY(z, cfg) {
    const _tBP = cfg.tBP;
    let lo = 0, hi = 1;
    for (let _i = 0; _i < 14; _i++) {
        const _m = (lo + hi) * 0.5, _u = 1 - _m;
        (_u*_u*_u*_tBP[0][0] + 3*_u*_u*_m*_tBP[1][0] + 3*_u*_m*_m*_tBP[2][0] + _m*_m*_m*_tBP[3][0] < z)
            ? (lo = _m) : (hi = _m);
    }
    const _t = (lo + hi) * 0.5, _u = 1 - _t;
    return _u*_u*_u*_tBP[0][1] + 3*_u*_u*_t*_tBP[1][1] + 3*_u*_t*_t*_tBP[2][1] + _t*_t*_t*_tBP[3][1];
}

function kickerBezY(z, cfg) {
    const _kBP = cfg.kBP;
    let lo = 0, hi = 1;
    for (let _i = 0; _i < 14; _i++) {
        const _m = (lo + hi) * 0.5, _u = 1 - _m;
        (_u*_u*_u*_kBP[0][0] + 3*_u*_u*_m*_kBP[1][0] + 3*_u*_m*_m*_kBP[2][0] + _m*_m*_m*_kBP[3][0] < z)
            ? (lo = _m) : (hi = _m);
    }
    const _t = (lo + hi) * 0.5, _u = 1 - _t;
    return _u*_u*_u*_kBP[0][1] + 3*_u*_u*_t*_kBP[1][1] + 3*_u*_t*_t*_kBP[2][1] + _t*_t*_t*_kBP[3][1];
}

function terrainRootY(z, cfg) {
    if (cfg.mode === 'trampoline') return cfg.TRAMPOLINE_Y;
    if (cfg.mode === 'trampolineMat') {
        // Crash mat surface is 0.28m above gym floor; translate to rootY threshold
        if (z >= cfg.MAT_LAND_START_Z && z <= cfg.MAT_LAND_END_Z) return cfg.TRAMPOLINE_Y + 0.28 + 0.10;
        return cfg.TRAMPOLINE_Y;
    }
    const SLOPE_ANGLE     = cfg.SLOPE_ANGLE;
    const SLOPE_START_Z   = cfg.SLOPE_START_Z;
    const FLAT_Z          = cfg.FLAT_Z;
    const TRANS_START_Z   = cfg.TRANS_START_Z;
    const TRANS_END_Z     = cfg.TRANS_END_Z;
    const KICKER_START_Z  = cfg.KICKER_START_Z;
    const KICKER_END_Z    = cfg.KICKER_END_Z;
    const LANDING_START_Z = cfg.LANDING_START_Z;
    const OUTRUN_Z        = cfg.OUTRUN_Z;
    const LANDING_ANGLE   = cfg.LANDING_ANGLE;
    if (z < SLOPE_START_Z) return -SLOPE_START_Z * Math.tan(SLOPE_ANGLE); // flat top
    const tableY = -FLAT_Z * Math.tan(SLOPE_ANGLE); // y-height of the flat table
    if (z < TRANS_START_Z) return -z * Math.tan(SLOPE_ANGLE); // straight inrun slope
    // ── Cubic bezier transition: slope angle → flat, 3m before + 3m after FLAT_Z ──
    if (z < TRANS_END_Z) return transBezY(z, cfg);
    // ── Flat table (TRANS_END_Z → KICKER_START_Z) ────────────────────────────────
    if (z <= KICKER_START_Z) return tableY;
    // ── Kicker: pure convex bezier KICKER_START_Z (flat) → KICKER_END_Z (lip angle) ──
    // P0/P1 both at tableY → zero entry tangent → mathematically cannot dip below table.
    if (z <= KICKER_END_Z) return kickerBezY(z, cfg);
    const _backFaceEndZ   = KICKER_END_Z + 0.5;
    const _landingStartZ  = LANDING_START_Z;
    // Landing: flat at tableY then simple straight slope downward
    if (z <= _landingStartZ) return tableY;
    if (z <= OUTRUN_Z) return tableY - (z - _landingStartZ) * Math.tan(LANDING_ANGLE);
    return tableY - (OUTRUN_Z - _landingStartZ) * Math.tan(LANDING_ANGLE); // flat outrun
}

function terrainAccelZ(z, cfg) {
    if (cfg.mode === 'trampoline' || cfg.mode === 'trampolineMat' || cfg.mode === 'pool') return 0;
    const g = 14.0;
    const SLOPE_START_Z = cfg.SLOPE_START_Z;
    const OUTRUN_Z      = cfg.OUTRUN_Z;
    if (z < SLOPE_START_Z) return 0;    // flat top
    if (z > OUTRUN_Z)      return -14.0; // flat outrun friction
    // Derive along-slope acceleration from terrain gradient.
    // accZ = -g * sin(θ) = -g * (dy/dz) / sqrt(1 + (dy/dz)²)
    // Works continuously across slope, transition, kicker, and landing.
    const eps  = 0.01;
    const dydz = (terrainRootY(z + eps, cfg) - terrainRootY(z - eps, cfg)) / (2 * eps);
    return -g * dydz / Math.sqrt(1 + dydz * dydz);
}


// ── Physics config factory ───────────────────────────────────────────────────
// The per-world tuning values live HERE, with the discipline, rather than in
// game.js. game.js parses the URL (environment access is its job) and passes the
// already-parsed parameters in; it holds no physics values of its own.
//
// TARGET_OMEGA_UNTUCKED is rad/s at full extension. The 4.5 * 0.9925 base is the
// world-normal flip rate; the per-world multiplier scales it to the hill size.
function makePhysicsConfig(opts) {
    const o = opts || {};
    const world = o.world;
    const mult =
          world === 'custom'     ? o.customFlipSpeed
        : world === 'trampoline' ? 1.407
        : world === 'quint'      ? 1.96
        : world === 'quad'       ? 1.63
        : world === 'triple'     ? 1.45
        : world === 'single'     ? 0.65
        : 1.10;
    return {
        GRAVITY: 14.0,                                  // world-units / s²
        TARGET_OMEGA_UNTUCKED: 4.5 * 0.9925 * mult,     // rad/s at full extension
    };
}

const api = { makePhysicsConfig, transBezY, kickerBezY, terrainRootY, terrainAccelZ };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).aerialSki = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
