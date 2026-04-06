'use strict';

// ── Segment definitions ────────────────────────────────────────────────────
// Each segment has a name, box size (w × h × d), and mass (arbitrary units,
// proportional to a real athlete — ratios are what matter for physics).
const SEGMENTS = [
    { name: 'torso',     w: 0.30, h: 0.55, d: 0.12, mass: 22.0, color: [0.12, 0.56, 1.00] },
    { name: 'head',      w: 0.24, h: 0.24, d: 0.12, mass:  6.0, color: [0.95, 0.95, 0.95] },
    { name: 'upperArmL', w: 0.11, h: 0.30, d: 0.10, mass:  2.5, color: [0.12, 0.56, 1.00] },
    { name: 'upperArmR', w: 0.11, h: 0.30, d: 0.10, mass:  2.5, color: [0.12, 0.56, 1.00] },
    { name: 'lowerArmL', w: 0.09, h: 0.25, d: 0.10, mass:  1.5, color: [0.12, 0.56, 1.00] },
    { name: 'lowerArmR', w: 0.09, h: 0.25, d: 0.10, mass:  1.5, color: [0.12, 0.56, 1.00] },
    { name: 'upperLegL', w: 0.13, h: 0.36, d: 0.12, mass:  7.0, color: [0.10, 0.10, 0.38] },
    { name: 'upperLegR', w: 0.13, h: 0.36, d: 0.12, mass:  7.0, color: [0.10, 0.10, 0.38] },
    { name: 'lowerLegL', w: 0.11, h: 0.36, d: 0.12, mass:  5.0, color: [0.08, 0.08, 0.08] },
    { name: 'lowerLegR', w: 0.11, h: 0.36, d: 0.12, mass:  5.0, color: [0.08, 0.08, 0.08] },
];

// ── Poses ─────────────────────────────────────────────────────────────────
// Local transform of each segment relative to the CoM root TransformNode.
// x, y  = local position (root is ~center of torso / whole-body CoM)
// rz    = local rotation around Z (radians, positive = counterclockwise in body frame)
//
// Root is at center of mass ≈ just above the hips / center of torso.

const POSE_UNTUCKED = {
    torso:     { x:  0.00, y:  0.00, rz:  0.00 },
    head:      { x:  0.00, y:  0.42, rz:  0.00 },
    upperArmL: { x: -0.21, y:  0.12, rz:  0.20 },   // arms slightly away from body
    upperArmR: { x:  0.21, y:  0.12, rz: -0.20 },
    lowerArmL: { x: -0.21, y: -0.18, rz:  0.10 },
    lowerArmR: { x:  0.21, y: -0.18, rz: -0.10 },
    upperLegL: { x: -0.10, y: -0.46, rz:  0.00 },   // legs hanging straight down
    upperLegR: { x:  0.10, y: -0.46, rz:  0.00 },
    lowerLegL: { x: -0.10, y: -0.86, rz:  0.00 },
    lowerLegR: { x:  0.10, y: -0.86, rz:  0.00 },
};

const POSE_TUCKED = {
    torso:     { x:  0.00, y:  0.00, rz:  0.40 },   // torso curls forward
    head:      { x: -0.04, y:  0.25, rz:  0.60 },   // head tucks toward knees
    upperArmL: { x: -0.15, y: -0.28, rz:  1.30 },   // arms wrap around shins
    upperArmR: { x:  0.15, y: -0.28, rz: -1.30 },
    lowerArmL: { x: -0.12, y: -0.52, rz:  1.40 },
    lowerArmR: { x:  0.12, y: -0.52, rz: -1.40 },
    upperLegL: { x: -0.05, y: -0.12, rz: -1.30 },   // thighs pulled up to chest
    upperLegR: { x:  0.05, y: -0.12, rz:  1.30 },
    lowerLegL: { x: -0.18, y: -0.32, rz: -0.80 },   // shins fold inward
    lowerLegR: { x:  0.18, y: -0.32, rz:  0.80 },
};

// ── Physics helpers ────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }

// Moment of inertia about the flip axis (Z) for a given tuck amount [0..1].
//   I = Σ [ m_i · r_i²  +  m_i · (w_i² + h_i²) / 12 ]
//   First term: point-mass at CoM distance from root.
//   Second term: self-inertia of each rectangular segment (constant, adds realistic baseline).
function computeI(tuck) {
    let I = 0;
    for (const seg of SEGMENTS) {
        const up = POSE_UNTUCKED[seg.name];
        const tk = POSE_TUCKED[seg.name];
        const x = lerp(up.x, tk.x, tuck);
        const y = lerp(up.y, tk.y, tuck);
        // Distance² from rotation axis
        I += seg.mass * (x * x + y * y);
        // Segment self-inertia (does not change with position, provides floor)
        I += seg.mass * (seg.w * seg.w + seg.h * seg.h) / 12;
    }
    return Math.max(I, 0.5); // prevent division by zero
}

// ── Character builder ──────────────────────────────────────────────────────
function buildCharacter(scene) {
    // Root TransformNode sits at the whole-body center of mass.
    // The flip rotation is applied to root; all segments move with it.
    const root = new BABYLON.TransformNode('skierRoot', scene);
    const meshes = {};

    for (const seg of SEGMENTS) {
        const mesh = BABYLON.MeshBuilder.CreateBox(seg.name, {
            width:  seg.w,
            height: seg.h,
            depth:  seg.d,
        }, scene);

        mesh.parent = root;

        // Small Z offset separates L/R segments to avoid depth-buffer fighting.
        // The orthographic side view camera looks along Z so this is invisible.
        if (seg.name.endsWith('L')) mesh.position.z =  0.07;
        if (seg.name.endsWith('R')) mesh.position.z = -0.07;

        const mat = new BABYLON.StandardMaterial(seg.name + '_mat', scene);
        mat.diffuseColor = new BABYLON.Color3(seg.color[0], seg.color[1], seg.color[2]);
        mesh.material = mat;

        meshes[seg.name] = mesh;
    }

    return { root, meshes };
}

// ── Pose applicator ────────────────────────────────────────────────────────
// Linearly interpolates each segment between the untucked and tucked poses.
function applyPose(meshes, tuck) {
    for (const seg of SEGMENTS) {
        const mesh = meshes[seg.name];
        const up   = POSE_UNTUCKED[seg.name];
        const tk   = POSE_TUCKED[seg.name];
        mesh.position.x = lerp(up.x, tk.x, tuck);
        mesh.position.y = lerp(up.y, tk.y, tuck);
        // position.z is set once in buildCharacter and never changed here
        mesh.rotation.z = lerp(up.rz, tk.rz, tuck);
    }
}

// ── HUD builder ────────────────────────────────────────────────────────────
function buildHUD(scene) {
    const ui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI', true, scene);

    const hud = new BABYLON.GUI.TextBlock('hud');
    hud.color       = '#b8d8ff';
    hud.fontSize    = 15;
    hud.fontFamily  = 'monospace';
    hud.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.textVerticalAlignment   = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    hud.left        = '14px';
    hud.top         = '14px';
    hud.resizeToFit = true;
    ui.addControl(hud);

    const hint = new BABYLON.GUI.TextBlock('hint');
    hint.color      = '#445566';
    hint.fontSize   = 13;
    hint.fontFamily = 'monospace';
    hint.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    hint.textVerticalAlignment   = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
    hint.top        = '-14px';
    hint.text       = 'SPACE hold: tuck / release: open     ← / →: arm drop spin (Phase 2)';
    ui.addControl(hint);

    return hud;
}

// ── Entry point ────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas');
    const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true });

    // ── Scene ───────────────────────────────────────────────────────────────
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.05, 0.08, 0.16, 1); // deep night sky

    // ── Orthographic camera — side view looking along +Z ────────────────────
    // Camera at z = -10 looking toward origin; character lives in the XY plane.
    const camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 0, -10), scene);
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;

    function setOrtho() {
        const w = engine.getRenderWidth();
        const h = engine.getRenderHeight();
        const halfH = 3.0; // world-unit half-height visible on screen
        camera.orthoTop    =  halfH;
        camera.orthoBottom = -halfH;
        camera.orthoLeft   = -halfH * (w / h);
        camera.orthoRight  =  halfH * (w / h);
    }
    setOrtho();
    window.addEventListener('resize', () => { engine.resize(); setOrtho(); });

    // ── Lighting ─────────────────────────────────────────────────────────────
    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.4, 1, -0.8), scene);
    hemi.intensity   = 1.0;
    hemi.groundColor = new BABYLON.Color3(0.2, 0.2, 0.3); // subtle cool fill from below

    // ── Character ─────────────────────────────────────────────────────────────
    const character = buildCharacter(scene);
    applyPose(character.meshes, 0); // start fully extended

    // ── Physics state ─────────────────────────────────────────────────────────
    //
    // FLIP:  L_flip = I · ω is set at takeoff and NEVER changes in the air.
    //        This is always a BACKFLIP — direction is fixed, cannot be reversed.
    //        Tuck changes I, so ω = L_flip / I varies, but L_flip stays constant.
    //
    // SPIN:  Separate rotation axis (Y). Can be initiated mid-air via arm drops.
    //        Stub only in Phase 1 — tracked in state, shown in HUD, not animated.
    //
    const TARGET_OMEGA_UNTUCKED = 3.0; // rad/s at full extension (~0.48 rot/s)
    const I0 = computeI(0);            // I at tuck = 0 (fully extended)

    const state = {
        // Flip (backflip, always clockwise from side view)
        L_flip:     I0 * TARGET_OMEGA_UNTUCKED, // conserved for entire flight
        flipAngle:  0.0,                         // integrated angle (radians)
        tuckAmount: 0.0,                         // current tuck [0..1]
        tuckTarget: 0.0,                         // desired tuck [0..1]

        // Spin — Phase 1 stub
        L_spin:     0.0,
        omega_spin: 0.0,
    };

    // ── Input ─────────────────────────────────────────────────────────────────
    // SPACE  — tuck while held, open when released
    // ← / → — arm drop to initiate spin (stub, no visual in 2D side view)
    window.addEventListener('keydown', e => {
        if (e.code === 'Space') {
            e.preventDefault();
            state.tuckTarget = 1.0;
        }
        // Arm drop: can only initiate spin once (realistic — you drop the arm, L_spin is set)
        if (e.code === 'ArrowLeft' && state.L_spin === 0) {
            e.preventDefault();
            const I_arm = 1.2; // approximate moment-of-inertia contribution of one arm
            state.L_spin = -I_arm * 3.0; // negative = left spin
        }
        if (e.code === 'ArrowRight' && state.L_spin === 0) {
            e.preventDefault();
            const I_arm = 1.2;
            state.L_spin = I_arm * 3.0;  // positive = right spin
        }
    });
    window.addEventListener('keyup', e => {
        if (e.code === 'Space') state.tuckTarget = 0.0;
    });

    // ── HUD ───────────────────────────────────────────────────────────────────
    const hud = buildHUD(scene);

    // ── Physics / render loop ─────────────────────────────────────────────────
    // Tuck transitions over 1/TUCK_RATE seconds (0.2 s)
    const TUCK_RATE = 5.0;

    scene.registerBeforeRender(() => {
        const dt = engine.getDeltaTime() / 1000; // seconds
        if (dt <= 0 || dt > 0.1) return;         // skip stalls / first frame

        // ── Smooth tuck transition ─────────────────────────────────────────
        const diff = state.tuckTarget - state.tuckAmount;
        const step = TUCK_RATE * dt;
        state.tuckAmount += (Math.abs(diff) <= step) ? diff : Math.sign(diff) * step;

        // ── Apply body pose ────────────────────────────────────────────────
        applyPose(character.meshes, state.tuckAmount);

        // ── Angular momentum conservation: ω = L / I ──────────────────────
        // L_flip is permanently fixed. I varies with tuck. ω follows from both.
        const I     = computeI(state.tuckAmount);
        const omega = state.L_flip / I;

        // ── Integrate flip angle ───────────────────────────────────────────
        // Backflip from a right-facing skier = clockwise in side view
        // = negative rotation.z in Babylon.js (right-hand rule, camera looking +Z)
        state.flipAngle           += omega * dt;
        character.root.rotation.z  = -state.flipAngle;

        // ── Spin stub ────────────────────────────────────────────────────
        // In 3D, this would drive rotation.y on the root.
        // I_spin is fixed here; real arm-drop mechanics will be added in Phase 2.
        const I_spin_current = 0.8; // placeholder
        state.omega_spin = (state.L_spin !== 0) ? (state.L_spin / I_spin_current) : 0;

        // ── HUD ───────────────────────────────────────────────────────────
        const rotations = state.flipAngle / (2 * Math.PI);
        hud.text = [
            '─── FLIP ──────────────────────────',
            `L_flip    : ${state.L_flip.toFixed(3)}  (conserved)`,
            `I_flip    : ${I.toFixed(3)}`,
            `ω_flip    : ${omega.toFixed(3)} rad/s`,
            `Rotations : ${rotations.toFixed(2)}`,
            `Tuck      : ${(state.tuckAmount * 100).toFixed(0)}%`,
            '─── SPIN (stub — Phase 2) ─────────',
            `L_spin    : ${state.L_spin.toFixed(3)}`,
            `ω_spin    : ${state.omega_spin.toFixed(3)} rad/s`,
        ].join('\n');
    });

    // ── Run ───────────────────────────────────────────────────────────────────
    engine.runRenderLoop(() => scene.render());
});
