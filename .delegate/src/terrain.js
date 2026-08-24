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

// ── Entry point ────────────────────────────────────────────────────────────
// Works whether DOM is still loading (normal sync case) or already ready
// (dynamic load case — CDN retry fires after DOMContentLoaded has passed).
function _startGame() {
    const canvas = document.getElementById('renderCanvas');
    // Detect WebGL support before starting — shows a clear error on old/unsupported hardware
    if (!BABYLON.Engine.isSupported()) {
        canvas.style.display = 'none';
