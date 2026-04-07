'use strict';

// ── Segment definitions ────────────────────────────────────────────────────
// Each segment has a name, box size (w × h × d), and mass (arbitrary units,
// proportional to a real athlete — ratios are what matter for physics).
const SEGMENTS = [
    { name: 'torso',     w: 0.30, h: 0.55, d: 0.28, mass: 22.0, color: [0.12, 0.56, 1.00] },
    { name: 'head',      w: 0.22, h: 0.24, d: 0.24, mass:  6.0, color: [0.95, 0.95, 0.95] },
    { name: 'upperArmL', w: 0.11, h: 0.30, d: 0.11, mass:  2.5, color: [0.12, 0.56, 1.00] },
    { name: 'upperArmR', w: 0.11, h: 0.30, d: 0.11, mass:  2.5, color: [0.12, 0.56, 1.00] },
    { name: 'lowerArmL', w: 0.09, h: 0.25, d: 0.09, mass:  1.5, color: [0.12, 0.56, 1.00] },
    { name: 'lowerArmR', w: 0.09, h: 0.25, d: 0.09, mass:  1.5, color: [0.12, 0.56, 1.00] },
    { name: 'upperLegL', w: 0.13, h: 0.36, d: 0.18, mass:  7.0, color: [0.10, 0.10, 0.38] },
    { name: 'upperLegR', w: 0.13, h: 0.36, d: 0.18, mass:  7.0, color: [0.10, 0.10, 0.38] },
    { name: 'lowerLegL', w: 0.11, h: 0.36, d: 0.14, mass:  5.0, color: [0.08, 0.08, 0.08] },
    { name: 'lowerLegR', w: 0.11, h: 0.36, d: 0.14, mass:  5.0, color: [0.08, 0.08, 0.08] },
    // Skis: long (≈ leg length), thin, flat — centered under each foot
    { name: 'skiL',      w: 0.08, h: 0.03, d: 1.20, mass:  2.0, color: [0.05, 0.10, 0.40] },
    { name: 'skiR',      w: 0.08, h: 0.03, d: 1.20, mass:  2.0, color: [0.05, 0.10, 0.40] },
];

// ── Poses ─────────────────────────────────────────────────────────────────
// Local transform of each segment relative to the CoM root TransformNode.
// x, y  = local position (root is ~center of torso / whole-body CoM)
// rz    = local rotation around Z (radians, positive = counterclockwise in body frame)
//
// Root is at center of mass ≈ just above the hips / center of torso.

// Base Z offsets — separate L/R segments to avoid depth-buffer fighting.
// These are constant and never changed by pose animation.
const BASE_Z = {
    torso: 0, head: 0,
    upperArmL:  0.07, upperArmR: -0.07,
    lowerArmL:  0.07, lowerArmR: -0.07,
    upperLegL:  0.07, upperLegR: -0.07,
    lowerLegL:  0.07, lowerLegR: -0.07,
    skiL:       0.07, skiR:      -0.07,
};

// Segment chain geometry (all heights for reference):
//   torso h=0.55  → top y=+0.275, bottom y=-0.275
//   head  h=0.24  → center y = 0.275 + 0.005(neck) + 0.12 = 0.40
//   shoulder y = 0.15 (mid-upper torso)
//   upperArm h=0.30 → shoulder=top, center = 0.15-0.15 = 0.00, elbow = -0.15
//   lowerArm h=0.25 → elbow=top,   center = -0.15-0.125 = -0.275, wrist = -0.40
//   hip y = -0.275 (bottom of torso)
//   upperLeg h=0.36 → hip=top,  center = -0.275-0.18 = -0.455, knee = -0.635
//   lowerLeg h=0.36 → knee=top, center = -0.635-0.18 = -0.815, foot = -0.995
// x offset arms = ±0.205, legs = ±0.075. dz = forward/back delta from BASE_Z.
// Backflip tuck folds in the YZ plane: knees come forward (+dz) up toward chest.

const POSE_UNTUCKED = {
    // All rx=0, dz=0 — segments hang straight down, arms at sides
    torso:     { x:  0.000, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },
    head:      { x:  0.000, y:  0.400, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperArmL: { x: -0.205, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperArmR: { x:  0.205, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmL: { x: -0.205, y: -0.275, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmR: { x:  0.205, y: -0.275, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperLegL: { x: -0.075, y: -0.455, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperLegR: { x:  0.075, y: -0.455, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerLegL: { x: -0.075, y: -0.815, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerLegR: { x:  0.075, y: -0.815, rx:  0.00, rz:  0.00, dz:  0.00 },
    // Skis centered under feet: foot bottom = -0.995, ski center = -0.995 - h/2 = -1.010
    skiL:      { x: -0.075, y: -1.010, rx:  0.00, rz:  0.00, dz:  0.00 },
    skiR:      { x:  0.075, y: -1.010, rx:  0.00, rz:  0.00, dz:  0.00 },
};

const POSE_TUCKED = {
    // Knees lift forward (-dz) and up toward chest — tuck in the YZ plane
    torso:     { x:  0.000, y:  0.000, rx:  0.35, rz:  0.00, dz:  0.00 },  // torso curls forward
    head:      { x:  0.000, y:  0.340, rx:  0.45, rz:  0.00, dz: -0.06 },  // chin toward knees
    upperArmL: { x: -0.160, y: -0.180, rx: -1.00, rz:  0.20, dz: -0.18 },  // arms reach forward to grab shins
    upperArmR: { x:  0.160, y: -0.180, rx: -1.00, rz: -0.20, dz: -0.18 },
    lowerArmL: { x: -0.100, y: -0.280, rx: -1.00, rz:  0.20, dz: -0.26 },
    lowerArmR: { x:  0.100, y: -0.280, rx: -1.00, rz: -0.20, dz: -0.26 },
    upperLegL: { x: -0.075, y: -0.140, rx: -1.20, rz:  0.00, dz: -0.20 },  // thighs up and forward
    upperLegR: { x:  0.075, y: -0.140, rx: -1.20, rz:  0.00, dz: -0.20 },
    lowerLegL: { x: -0.075, y: -0.230, rx: -0.55, rz:  0.00, dz: -0.10 },  // shins fold in
    lowerLegR: { x:  0.075, y: -0.230, rx: -0.55, rz:  0.00, dz: -0.10 },
    // Skis track feet: foot moves to ~y=-0.396 at same rx as lower leg
    skiL:      { x: -0.075, y: -0.410, rx: -0.55, rz:  0.00, dz:  0.00 },
    skiR:      { x:  0.075, y: -0.410, rx: -0.55, rz:  0.00, dz:  0.00 },
};

// ── Physics helpers ────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }

// Moment of inertia about the flip axis (X, shoulder-to-shoulder).
// Distance from X axis = sqrt(y² + z²), so I = Σ [ m_i·(y_i²+z_i²) + m_i·(h_i²+d_i²)/12 ]
function computeI(tuck) {
    let I = 0;
    for (const seg of SEGMENTS) {
        const up = POSE_UNTUCKED[seg.name];
        const tk = POSE_TUCKED[seg.name];
        const y  = lerp(up.y,  tk.y,  tuck);
        const dz = lerp(up.dz, tk.dz, tuck);
        const z  = (BASE_Z[seg.name] || 0) + dz;
        I += seg.mass * (y * y + z * z);
        // Self-inertia of box around X axis: m*(h² + d²)/12
        I += seg.mass * (seg.h * seg.h + seg.d * seg.d) / 12;
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

        const mat = new BABYLON.StandardMaterial(seg.name + '_mat', scene);
        mat.diffuseColor = new BABYLON.Color3(seg.color[0], seg.color[1], seg.color[2]);
        mesh.material = mat;

        meshes[seg.name] = mesh;
    }

    return { root, meshes };
}

// ── Pose applicator ────────────────────────────────────────────────────────
// Linearly interpolates each segment between the untucked and tucked poses.
// Tuck folds in the YZ plane (knees forward toward chest) matching the X-axis backflip.
function applyPose(meshes, tuck) {
    for (const seg of SEGMENTS) {
        const mesh = meshes[seg.name];
        const up   = POSE_UNTUCKED[seg.name];
        const tk   = POSE_TUCKED[seg.name];
        mesh.position.x = lerp(up.x,  tk.x,  tuck);
        mesh.position.y = lerp(up.y,  tk.y,  tuck);
        mesh.position.z = (BASE_Z[seg.name] || 0) + lerp(up.dz, tk.dz, tuck);
        mesh.rotation.x = lerp(up.rx, tk.rx, tuck);
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
    hud.horizontalAlignment     = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
    hud.verticalAlignment       = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    hud.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.paddingRight = '14px';
    hud.paddingTop   = '14px';
    hud.resizeToFit = true;
    ui.addControl(hud);

    const hint = new BABYLON.GUI.TextBlock('hint');
    hint.color      = '#445566';
    hint.fontSize   = 13;
    hint.fontFamily = 'monospace';
    hint.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    hint.textVerticalAlignment   = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
    hint.top        = '-14px';
    hint.text       = 'SPACE: tuck     ← / →: spin (Phase 2)     drag: orbit camera';
    ui.addControl(hint);

    return hud;
}

// ── Entry point ────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas');
    const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true });

    // ── Scene ───────────────────────────────────────────────────────────────
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(1, 1, 1, 1);

    // ── Orbiting orthographic camera ─────────────────────────────────────────
    // ArcRotateCamera orbits the origin on left-click drag / touch drag.
    // Orthographic mode keeps the character the same size at all angles.
    const camera = new BABYLON.ArcRotateCamera('cam',
        0,              // alpha: camera on the +X side — looking at character's right side
        Math.PI / 2,    // beta:  horizon level
        10,             // radius
        BABYLON.Vector3.Zero(), scene);

    camera.attachControl(canvas, true);
    camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    camera.lowerBetaLimit   = 0.05;          // prevent flipping under the scene
    camera.upperBetaLimit   = Math.PI - 0.05;
    camera.lowerRadiusLimit = 10;            // lock zoom — meaningless in ortho
    camera.upperRadiusLimit = 10;
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
    const TARGET_OMEGA_UNTUCKED = 4.5; // rad/s at full extension
    const MAX_OMEGA = 9.75;            // rad/s cap — limits tucked flip speed
    const I0 = computeI(0);            // I at tuck = 0 (fully extended)

    const state = {
        L_flip:     I0 * TARGET_OMEGA_UNTUCKED,
        flipAngle:  0.0,
        tuckAmount: 0.0,
        tuckTarget: 0.0,
        twistRate:  0,    // twists per flip; increments on each keydown, resets on keyup
        spinAngle:  0.0,  // integrated incrementally to avoid discontinuous jumps
        snapTarget: null, // set on key release to nearest half-twist; null = not snapping
    };

    const SNAP_SPEED = Math.PI * 4; // rad/s — snaps within ~0.25 s

    let rightPresses = 0;
    let leftPresses  = 0;
    let rightDown    = false; // track whether key is already held
    let leftDown     = false;

    // Initialise rotationQuaternion so Babylon doesn't mix with euler rotation.
    character.root.rotationQuaternion = BABYLON.Quaternion.Identity();


    // ── Input ─────────────────────────────────────────────────────────────────
    // SPACE  — tuck while held, open when released
    // ← / → — arm drop to initiate spin (stub, no visual in 2D side view)
    window.addEventListener('keydown', e => {
        if (e.code === 'Space') {
            e.preventDefault();
            state.tuckTarget = 1.0;
        }
        if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
            e.preventDefault(); // prevent camera pan
        }
        if (e.code === 'ArrowLeft') {
            e.preventDefault();
            if (!leftDown) { leftDown = true; leftPresses++; state.twistRate = -(leftPresses * 1.1); }
        }
        if (e.code === 'ArrowRight') {
            e.preventDefault();
            if (!rightDown) { rightDown = true; rightPresses++; state.twistRate = rightPresses * 1.1; }
        }
    });
    window.addEventListener('keyup', e => {
        if (e.code === 'Space') state.tuckTarget = 0.0;
        if (e.code === 'ArrowLeft' && leftDown) {
            leftDown = false;
            state.twistRate = 0;
            // Snap to nearest half-twist (multiple of π)
            state.snapTarget = Math.round(state.spinAngle / Math.PI) * Math.PI;
        }
        if (e.code === 'ArrowRight' && rightDown) {
            rightDown = false;
            state.twistRate = 0;
            state.snapTarget = Math.round(state.spinAngle / Math.PI) * Math.PI;
        }
    });

    // ── HUD ───────────────────────────────────────────────────────────────────
    const hud = buildHUD(scene);

    // ── Physics / render loop ─────────────────────────────────────────────────
    // Tuck transitions over 1/TUCK_RATE seconds (0.2 s)
    const TUCK_RATE = 2.5;

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
        const omega = Math.min(state.L_flip / I, MAX_OMEGA);

        const prevFlips = Math.floor(state.flipAngle / (Math.PI * 2));
        state.flipAngle += omega * dt;
        const newFlips  = Math.floor(state.flipAngle / (Math.PI * 2));

        // Reset press counters every time a full flip completes
        if (newFlips > prevFlips) {
            rightPresses = 0;
            leftPresses  = 0;
        }

        // Integrate spin or snap to nearest half-twist after release
        if (state.twistRate !== 0) {
            state.spinAngle += state.twistRate * omega * dt;
            state.snapTarget = null; // cancel any pending snap while actively spinning
        } else if (state.snapTarget !== null) {
            const snapDiff = state.snapTarget - state.spinAngle;
            const snapStep = SNAP_SPEED * dt;
            if (Math.abs(snapDiff) <= snapStep) {
                state.spinAngle = state.snapTarget;
                state.snapTarget = null;
            } else {
                state.spinAngle += Math.sign(snapDiff) * snapStep;
            }
        }

        const spinAngle = state.spinAngle;

        // qFlip * qSpin — spin in body-local space (always head-to-feet axis)
        const qFlip = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, state.flipAngle);
        const qSpin = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, spinAngle);
        character.root.rotationQuaternion = qFlip.multiply(qSpin);

        // ── HUD ───────────────────────────────────────────────────────────
        const rotations = state.flipAngle / (2 * Math.PI);
        hud.text = [
            '─── FLIP ──────────────────────────',
            `L_flip    : ${state.L_flip.toFixed(3)}  (conserved)`,
            `I_flip    : ${I.toFixed(3)}`,
            `ω_flip    : ${omega.toFixed(3)} rad/s`,
            `Rotations : ${rotations.toFixed(2)}`,
            `Tuck      : ${(state.tuckAmount * 100).toFixed(0)}%`,
            '─── SPIN ──────────────────────────',
            `Twist rate : ${state.twistRate}/flip`,
            `Spin angle : ${(state.twistRate * rotations).toFixed(2)} rev`,
        ].join('\n');
    });

    // ── Run ───────────────────────────────────────────────────────────────────
    engine.runRenderLoop(() => scene.render());
});
