function armSweep(name, _up, t) {
    const phi  = Math.PI * t;           // 0 (up) → π (down)
    const baseX = (name === 'upperArmR' || name === 'lowerArmR') ? 0.205 : -0.205;
    // Radial distances from the shoulder pivot (y=0.150) along the arm chain:
    //   upper-arm centre: h/2         = 0.30/2        = 0.150
    //   lower-arm centre: h_u + h_l/2 = 0.30 + 0.125  = 0.425
    const dist = (name === 'lowerArmL' || name === 'lowerArmR') ? 0.425 : 0.150;
    return {
        x:  baseX,
        y:  0.150 + dist * Math.cos(phi),   // 0.300/0.575 up → 0.000/-0.275 down
        rx: -phi,                            // 0 up → -π/2 forward → -π down
        rz: 0,
        dz: -dist * Math.sin(phi),           // 0 up → max-forward at mid-arc → 0 down
    };
}

// ── Pose applicator ────────────────────────────────────────────────────────
// tuck:       0 = fully extended, 1 = fully tucked
// armDropL:   0 = left arm raised, 1 = left arm dropped to side
// armDropR:   0 = right arm raised, 1 = right arm dropped to side
// armSnap:    0-1, blends arms toward POSE_ARMS_50DEG (overrides armDrop for arm segments)
// layArmT:    0-1, blends arms toward T-pose (layout)
// armRaise:   0-1, blends arms toward raised-overhead pose
// grounded:   true → use POSE_INRUN_TUCK, false → use POSE_TUCKED
// pikeAmount: 0-1, blends toward POSE_PIKED
// pikeArmDrop:0-1, drops arms during pike release
function applyPose(meshes, tuck, armDropL, armDropR, armSnap, layArmT, armRaise, grounded, pikeAmount, pikeArmDrop) {
