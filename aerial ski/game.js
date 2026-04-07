'use strict';

// ── Segment definitions ────────────────────────────────────────────────────
// Each segment has a name, box size (w × h × d), and mass (arbitrary units,
// proportional to a real athlete — ratios are what matter for physics).
const SEGMENTS = [
    { name: 'torso',     w: 0.30, h: 0.55, d: 0.28, mass: 22.0, color: [0.12, 0.56, 1.00] },
    { name: 'head',      w: 0.22, h: 0.24, d: 0.24, mass:  6.0, color: [0.90, 0.30, 0.02] },
    { name: 'upperArmL', w: 0.11, h: 0.30, d: 0.11, mass:  2.5, color: [0.12, 0.56, 1.00] },
    { name: 'upperArmR', w: 0.11, h: 0.30, d: 0.11, mass:  2.5, color: [0.12, 0.56, 1.00] },
    { name: 'lowerArmL', w: 0.09, h: 0.25, d: 0.09, mass:  1.5, color: [0.12, 0.56, 1.00] },
    { name: 'lowerArmR', w: 0.09, h: 0.25, d: 0.09, mass:  1.5, color: [0.12, 0.56, 1.00] },
    { name: 'upperLegL', w: 0.13, h: 0.36, d: 0.18, mass:  7.0, color: [0.10, 0.10, 0.38] },
    { name: 'upperLegR', w: 0.13, h: 0.36, d: 0.18, mass:  7.0, color: [0.10, 0.10, 0.38] },
    { name: 'lowerLegL', w: 0.11, h: 0.36, d: 0.14, mass:  5.0, color: [0.12, 0.12, 0.55] },
    { name: 'lowerLegR', w: 0.11, h: 0.36, d: 0.14, mass:  5.0, color: [0.12, 0.12, 0.55] },
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
    upperArmL: { x: -0.205, y:  0.300, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperArmR: { x:  0.205, y:  0.300, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmL: { x: -0.205, y:  0.575, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmR: { x:  0.205, y:  0.575, rx:  0.00, rz:  0.00, dz:  0.00 },
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

// Arm sweep: two-phase animation.
// Phase 1 (armDrop 0→0.5): raised → swung out in front (horizontal forward)
// Phase 2 (armDrop 0.5→1): in front → hanging at side
// Character faces -Z, so dz negative = in front of body.
const POSE_ARMS_FORWARD = {
    upperArmL: { x: -0.205, y:  0.150, rx: -1.57, rz:  0.00, dz: -0.15 },
    upperArmR: { x:  0.205, y:  0.150, rx: -1.57, rz:  0.00, dz: -0.15 },
    lowerArmL: { x: -0.205, y:  0.150, rx: -1.57, rz:  0.00, dz: -0.40 },
    lowerArmR: { x:  0.205, y:  0.150, rx: -1.57, rz:  0.00, dz: -0.40 },
};
const POSE_ARMS_DROPPED = {
    upperArmL: { x: -0.205, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperArmR: { x:  0.205, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmL: { x: -0.205, y: -0.275, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmR: { x:  0.205, y: -0.275, rx:  0.00, rz:  0.00, dz:  0.00 },
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
        const n = seg.name;
        let mesh;

        if (n === 'head') {
            // Sphere for the helmet
            mesh = BABYLON.MeshBuilder.CreateSphere(n, {
                diameter: seg.h,
                segments: 12,
            }, scene);
        } else if (n === 'torso') {
            // Tapered cylinder — wider at shoulders, narrower at hips
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameterTop:    seg.w,
                diameterBottom: seg.w * 0.68,
                height:         seg.h,
                tessellation:   12,
            }, scene);
        } else if (n === 'skiL' || n === 'skiR') {
            // Skis remain flat boxes
            mesh = BABYLON.MeshBuilder.CreateBox(n, {
                width:  seg.w,
                height: seg.h,
                depth:  seg.d,
            }, scene);
        } else {
            // All limb segments — rounded cylinders
            const diam = (seg.w + seg.d) / 2;
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameter:     diam,
                height:       seg.h,
                tessellation: 8,
            }, scene);
        }

        mesh.parent = root;

        const mat = new BABYLON.StandardMaterial(n + '_mat', scene);
        mat.diffuseColor  = new BABYLON.Color3(seg.color[0], seg.color[1], seg.color[2]);
        mat.specularColor = new BABYLON.Color3(0.35, 0.35, 0.35);
        mat.specularPower = 32;
        mesh.material = mat;

        meshes[n] = mesh;

        // ── Per-segment detail meshes ────────────────────────────────────
        if (n === 'head') {
            // Goggle visor band on the front of the helmet (camera faces +Z)
            const visor = BABYLON.MeshBuilder.CreateBox('visor', {
                width:  seg.h * 0.70,
                height: seg.h * 0.22,
                depth:  seg.h * 0.18,
            }, scene);
            visor.parent = mesh;
            visor.position.set(0, 0.01, -seg.h * 0.44);
            const vMat = new BABYLON.StandardMaterial('visor_mat', scene);
            vMat.diffuseColor  = new BABYLON.Color3(0.04, 0.04, 0.04);
            vMat.specularColor = new BABYLON.Color3(0.7, 0.75, 0.9);
            vMat.specularPower = 80;
            visor.material = vMat;
        }

        if (n === 'lowerArmL' || n === 'lowerArmR') {
            // Glove sphere at the wrist end — position updated dynamically in applyPose
            const hand = BABYLON.MeshBuilder.CreateSphere(n + '_glove', {
                diameter: (seg.w + seg.d) / 2 * 1.5,
                segments: 6,
            }, scene);
            hand.parent = mesh;
            hand.position.set(0, -seg.h * 0.5, 0); // default: wrist at bottom (hanging)
            const hMat = new BABYLON.StandardMaterial(n + '_glove_mat', scene);
            hMat.diffuseColor  = new BABYLON.Color3(0.06, 0.06, 0.06);
            hMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
            hand.material = hMat;
            // Store so applyPose can reposition per frame
            meshes[n === 'lowerArmL' ? 'gloveL' : 'gloveR'] = { mesh: hand, halfH: seg.h * 0.5 };
        }

        if (n === 'lowerLegL' || n === 'lowerLegR') {
            // Ski boot block at the base of each shin
            const boot = BABYLON.MeshBuilder.CreateBox(n + '_boot', {
                width:  seg.w * 1.6,
                height: seg.h * 0.32,
                depth:  seg.d * 1.3,
            }, scene);
            boot.parent = mesh;
            boot.position.set(0, -seg.h * 0.34, 0);
            const bMat = new BABYLON.StandardMaterial(n + '_boot_mat', scene);
            bMat.diffuseColor  = new BABYLON.Color3(0.55, 0.08, 0.08);
            bMat.specularColor = new BABYLON.Color3(0.45, 0.25, 0.25);
            bMat.specularPower = 28;
            boot.material = bMat;
        }
    }

    return { root, meshes };
}

// Two-phase arm sweep helper.
// t 0→0.5: raised → swung forward in front of body
// t 0.5→1: from in front → hanging at side
function armSweep(name, up, t) {
    const fw = POSE_ARMS_FORWARD[name];
    const dp = POSE_ARMS_DROPPED[name];
    if (t <= 0.5) {
        const s = t * 2;
        return {
            x:  lerp(up.x,  fw.x,  s),
            y:  lerp(up.y,  fw.y,  s),
            rx: lerp(up.rx, fw.rx, s),
            rz: lerp(up.rz, fw.rz, s),
            dz: lerp(up.dz, fw.dz, s),
        };
    } else {
        const s = (t - 0.5) * 2;
        return {
            x:  lerp(fw.x,  dp.x,  s),
            y:  lerp(fw.y,  dp.y,  s),
            rx: lerp(fw.rx, dp.rx, s),
            rz: lerp(fw.rz, dp.rz, s),
            dz: lerp(fw.dz, dp.dz, s),
        };
    }
}

// ── Pose applicator ────────────────────────────────────────────────────────
// tuck:     0 = fully extended, 1 = fully tucked
// armDropL: 0 = left arm raised, 1 = left arm dropped to side
// armDropR: 0 = right arm raised, 1 = right arm dropped to side
function applyPose(meshes, tuck, armDropL, armDropR) {
    for (const seg of SEGMENTS) {
        const mesh = meshes[seg.name];
        const up   = POSE_UNTUCKED[seg.name];
        const tk   = POSE_TUCKED[seg.name];
        let ex = up;

        if (seg.name === 'upperArmL' || seg.name === 'lowerArmL') {
            ex = armSweep(seg.name, up, armDropL);
        } else if (seg.name === 'upperArmR' || seg.name === 'lowerArmR') {
            ex = armSweep(seg.name, up, armDropR);
        }

        mesh.position.x = lerp(ex.x,  tk.x,  tuck);
        mesh.position.y = lerp(ex.y,  tk.y,  tuck);
        mesh.position.z = (BASE_Z[seg.name] || 0) + lerp(ex.dz, tk.dz, tuck);
        mesh.rotation.x = lerp(ex.rx, tk.rx, tuck);
        mesh.rotation.z = lerp(ex.rz, tk.rz, tuck);
    }

    // ── Reposition gloves to always sit at the wrist ───────────────────────
    // When arm is raised (armDrop=0) the wrist is at the TOP of lowerArm (+h/2).
    // When arm is dropped (armDrop=1) the wrist is at the BOTTOM (-h/2).
    // During tuck the arms fold forward; keep glove at bottom in that case.
    if (meshes.gloveL) {
        const effectiveDrop = Math.max(armDropL, tuck);
        meshes.gloveL.mesh.position.y = lerp(meshes.gloveL.halfH, -meshes.gloveL.halfH, effectiveDrop);
    }
    if (meshes.gloveR) {
        const effectiveDrop = Math.max(armDropR, tuck);
        meshes.gloveR.mesh.position.y = lerp(meshes.gloveR.halfH, -meshes.gloveR.halfH, effectiveDrop);
    }
}

// ── HUD builder ────────────────────────────────────────────────────────────
function buildHUD(scene) {
    const ui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI', true, scene);

    const hud = new BABYLON.GUI.TextBlock('hud');
    hud.color       = '#b8d8ff';
    hud.fontSize    = 15;
    hud.fontFamily  = 'monospace';
    hud.horizontalAlignment     = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.verticalAlignment       = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    hud.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.paddingLeft  = '14px';
    hud.paddingTop   = '14px';
    hud.resizeToFit = true;
    ui.addControl(hud);

    const hint = new BABYLON.GUI.TextBlock('hint');
    hint.color      = '#445566';
    hint.fontSize   = 13;
    hint.fontFamily = 'monospace';
    hint.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
    hint.horizontalAlignment     = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
    hint.verticalAlignment       = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    hint.paddingRight = '14px';
    hint.paddingTop   = '14px';
    hint.text       = 'SPACE: tuck\n← then →: left twist\n→ then ←: right twist\ndrag: orbit';
    hint.resizeToFit = true;
    ui.addControl(hint);

    return hud;
}

// ── Terrain ───────────────────────────────────────────────────────────────────
// Character moves in the +Z direction. Camera views from -X side (right-to-left = downhill).
const FOOT_OFFSET   = 1.025;
const SLOPE_ANGLE   = 22 * Math.PI / 180;
const KICKER_ANGLE  = 55 * Math.PI / 180;
const LANDING_ANGLE = 40 * Math.PI / 180;
const LANDING_DROP  = 3.5; // extra vertical drop of landing zone
const KICKER_Z      = 22;
const KICKER_END_Z  = 24.5;

function terrainRootY(z) {
    if (z < 0) return 0; // flat start
    if (z < KICKER_Z) return -z * Math.tan(SLOPE_ANGLE);
    if (z <= KICKER_END_Z) {
        const baseY = -KICKER_Z * Math.tan(SLOPE_ANGLE);
        return baseY + (z - KICKER_Z) * Math.tan(KICKER_ANGLE);
    }
    const landingBase = -KICKER_Z * Math.tan(SLOPE_ANGLE) - LANDING_DROP;
    return landingBase - (z - KICKER_END_Z) * Math.tan(LANDING_ANGLE);
}

function terrainAccelZ(z) {
    const g = 14.0;
    if (z >= 0 && z < KICKER_Z)      return g * Math.sin(SLOPE_ANGLE);
    if (z >= KICKER_Z && z <= KICKER_END_Z) return -g * Math.sin(KICKER_ANGLE);
    if (z > KICKER_END_Z) return g * Math.sin(LANDING_ANGLE);
    return 0;
}

// ── Entry point ────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas');
    const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true });

    // ── Scene ───────────────────────────────────────────────────────────────
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.53, 0.81, 0.98, 1);

    // ── Orbiting orthographic camera ─────────────────────────────────────────
    // ArcRotateCamera orbits the origin on left-click drag / touch drag.
    // Orthographic mode keeps the character the same size at all angles.
    const camera = new BABYLON.ArcRotateCamera('cam',
        Math.PI,        // alpha: camera on the -X side — side view of slope
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
    applyPose(character.meshes, 0, 0, 0); // start fully extended, arms raised

    // ── Terrain meshes (visual — physics uses terrainRootY()) ────────────────────
    const snowMat = new BABYLON.StandardMaterial('snowMat', scene);
    snowMat.diffuseColor = new BABYLON.Color3(0.92, 0.97, 1.0);

    // Main slope
    const slopeBox = BABYLON.MeshBuilder.CreateBox('slope',
        { width: 10, height: 1.2, depth: KICKER_Z / Math.cos(SLOPE_ANGLE) }, scene);
    slopeBox.rotation.x = SLOPE_ANGLE;
    slopeBox.position.set(0, terrainRootY(KICKER_Z / 2) - FOOT_OFFSET - 0.6, KICKER_Z / 2);
    slopeBox.material = snowMat;

    // Kicker
    const kickerBox = BABYLON.MeshBuilder.CreateBox('kicker',
        { width: 10, height: 1.2, depth: (KICKER_END_Z - KICKER_Z) / Math.cos(KICKER_ANGLE) }, scene);
    kickerBox.rotation.x = -KICKER_ANGLE;
    kickerBox.position.set(0,
        terrainRootY((KICKER_Z + KICKER_END_Z) / 2) - FOOT_OFFSET - 0.6,
        (KICKER_Z + KICKER_END_Z) / 2);
    kickerBox.material = snowMat;

    // Sloped landing zone
    const landingMidZ = KICKER_END_Z + 30;
    const landingBox = BABYLON.MeshBuilder.CreateBox('landing',
        { width: 10, height: 1.2, depth: 60 / Math.cos(LANDING_ANGLE) }, scene);
    landingBox.rotation.x = LANDING_ANGLE;
    landingBox.position.set(0, terrainRootY(landingMidZ) - FOOT_OFFSET - 0.6, landingMidZ);
    landingBox.material = snowMat;

    // Flat start area (behind slope start)
    const startBox = BABYLON.MeshBuilder.CreateBox('start',
        { width: 10, height: 1.2, depth: 20 }, scene);
    startBox.position.set(0, -FOOT_OFFSET - 0.6, -10);
    startBox.material = snowMat;

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

    const SPIN_SPEED    = Math.PI * 2.0; // rad/s ~= 1.0 full twist/second
    const ARM_DROP_RATE = 4.0;            // arm transitions in ~0.25 s
    const GRAVITY       = 14.0;           // world-units / s²

    const state = {
        L_flip:     I0 * TARGET_OMEGA_UNTUCKED,
        flipAngle:  0.0,
        tuckAmount: 0.0,
        tuckTarget: 0.0,
        spinAngle:  0.0,  // current spin angle (rad)
        spinTarget: 0.0,  // target spin; each tap adds ±2π
        doubleDir:  1,    // +1 = left twist, -1 = right twist (used in double mode)
        armDropL:   0.0,  // 0 = raised, 1 = dropped to side
        armDropR:   0.0,
        rootY:      0.0,  // world Y of character root
        vy:         0.0,  // vertical velocity (world-units/s)
        posZ:       2.0,  // Z position (start on the slope)
        vz:         0.0,  // Z velocity — frictionless, only gravity along slope
        grounded:   true,
        crashed:    false, // true when landed badly
        crashAngle: 0.0,  // target flip angle to animate toward after crash
    };

    let leftDown        = false;
    let rightDown       = false;
    let doubleMode      = false; // both keys held → continuous 2x speed spin
    let secondKeyTimer  = null;  // timeout handle; fires after hold threshold
    const DOUBLE_HOLD_MS = 180;  // ms — hold second key longer than this = double mode

    // Initialise rotationQuaternion so Babylon doesn't mix with euler rotation.
    character.root.rotationQuaternion = BABYLON.Quaternion.Identity();


    // ── Input ─────────────────────────────────────────────────────────────────
    // SPACE        — tuck while held, open on release
    // ← then tap → — single left twist at normal speed
    // → then tap ← — single right twist at normal speed
    // ← then hold → — double mode: 2× speed left twist while both held
    // → then hold ← — double mode: 2× speed right twist while both held
    //
    // Tap vs hold is distinguished by a timer: if the second key is still down
    // after DOUBLE_HOLD_MS, double mode activates; if released before, it was
    // a single-twist tap.
    function enterDoubleMode(dir) {
        secondKeyTimer = null;
        doubleMode = true;
        state.doubleDir = dir;
    }
    function exitDoubleMode() {
        if (secondKeyTimer !== null) { clearTimeout(secondKeyTimer); secondKeyTimer = null; }
        doubleMode = false;
        state.spinTarget = Math.round(state.spinAngle / (Math.PI * 2)) * Math.PI * 2;
    }

    window.addEventListener('keydown', e => {
        if (e.code === 'Space') {
            e.preventDefault();
            if (!state.crashed) state.tuckTarget = 1.0;
        }
        if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
            e.preventDefault();
        }
        if (e.code === 'ArrowLeft' && !leftDown && !state.crashed) {
            e.preventDefault();
            leftDown = true;
            if (rightDown && !doubleMode) {
                // → already held: fire one right twist immediately, start hold timer
                state.spinTarget -= Math.PI * 2;
                state.doubleDir = -1;
                secondKeyTimer = setTimeout(() => enterDoubleMode(-1), DOUBLE_HOLD_MS);
            }
            // else: drop left arm as wind-up, wait for →
        }
        if (e.code === 'ArrowRight' && !rightDown && !state.crashed) {
            e.preventDefault();
            rightDown = true;
            if (leftDown && !doubleMode) {
                // ← already held: fire one left twist immediately, start hold timer
                state.spinTarget += Math.PI * 2;
                state.doubleDir = 1;
                secondKeyTimer = setTimeout(() => enterDoubleMode(1), DOUBLE_HOLD_MS);
            }
            // else: drop right arm as wind-up, wait for ←
        }
    });
    window.addEventListener('keyup', e => {
        if (e.code === 'Space') state.tuckTarget = 0.0;
        if (e.code === 'ArrowLeft' && leftDown) {
            leftDown = false;
            if (doubleMode) exitDoubleMode();
            else if (secondKeyTimer !== null) { clearTimeout(secondKeyTimer); secondKeyTimer = null; }
        }
        if (e.code === 'ArrowRight' && rightDown) {
            rightDown = false;
            if (doubleMode) exitDoubleMode();
            else if (secondKeyTimer !== null) { clearTimeout(secondKeyTimer); secondKeyTimer = null; }
        }
    });

    // ── HUD ───────────────────────────────────────────────────────────────────
    const hud = buildHUD(scene);

    // ── Physics / render loop ─────────────────────────────────────────────────
    // Tuck transitions over 1/TUCK_RATE seconds (0.17 s)
    const TUCK_RATE = 3.0;

    scene.registerBeforeRender(() => {
        const dt = engine.getDeltaTime() / 1000; // seconds
        if (dt <= 0 || dt > 0.1) return;         // skip stalls / first frame

        // ── Smooth tuck transition ─────────────────────────────────────────
        if (!state.crashed) {
        const diff = state.tuckTarget - state.tuckAmount;
        const step = TUCK_RATE * dt;
        state.tuckAmount += (Math.abs(diff) <= step) ? diff : Math.sign(diff) * step;
        }

        // ── Terrain physics (frictionless) ────────────────────────────────
        if (state.grounded) {
            const prevZ = state.posZ;
            state.vz   += terrainAccelZ(state.posZ) * dt;
            state.posZ += state.vz * dt;
            // Only launch when actually crossing the kicker tip (not after landing past it)
            if (prevZ <= KICKER_END_Z && state.posZ > KICKER_END_Z) {
                state.vy       = state.vz * Math.sin(KICKER_ANGLE);
                state.vz       = state.vz * Math.cos(KICKER_ANGLE);
                state.rootY    = terrainRootY(KICKER_END_Z);
                state.grounded = false;
            } else {
                state.rootY = terrainRootY(state.posZ);
            }
        } else {
            state.vy    -= GRAVITY * dt;
            state.rootY += state.vy * dt;
            state.posZ  += state.vz * dt;
            const surY   = terrainRootY(state.posZ);
            if (state.rootY <= surY) {
                const TWO_PI  = Math.PI * 2;
                const norm    = ((state.flipAngle % TWO_PI) + TWO_PI) % TWO_PI;
                const LAND_TOL = Math.PI / 4; // 45° — clean landing window
                const goodLanding = norm < LAND_TOL || norm > TWO_PI - LAND_TOL;

                state.rootY      = surY;
                state.vy         = 0;
                state.grounded   = true;
                state.spinAngle  = 0;
                state.spinTarget = 0;
                state.tuckTarget = 0;
                state.tuckAmount = 0;

                if (goodLanding) {
                    state.crashed   = false;
                    state.flipAngle = 0;
                    // preserve vz so skier glides away down the landing slope
                } else {
                    state.crashed = true;
                    state.vz      = 0; // stop sliding on crash
                    // Snap toward nearest lying-flat angle:
                    // norm < π  → back leading → land on back  (π)
                    // norm >= π → front leading → land on stomach (3π/2 → face down)
                    state.crashAngle = norm < Math.PI ? Math.PI : Math.PI * 1.5;
                }
            }
        }
        character.root.position.y = state.rootY;
        character.root.position.z = state.posZ;

        // ── Angular momentum conservation: ω = L / I ──────────────────────
        const I     = computeI(state.tuckAmount);
        const omega = Math.min(state.L_flip / I, MAX_OMEGA);
        if (!state.grounded) {
            state.flipAngle += omega * dt;
        }
        // ── Crash: animate flip angle toward lying-flat position ───────────
        if (state.crashed) {
            const diff = state.crashAngle - state.flipAngle;
            // normalise to [-π, π] so we always take the short arc
            const normDiff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
            const step = 6.0 * dt;
            state.flipAngle += Math.abs(normDiff) <= step ? normDiff : Math.sign(normDiff) * step;
        }

        // ── Spin ──────────────────────────────────────────────────────────
        if (!state.grounded) {
            if (doubleMode) {
                // Continuous spin at 2× speed while both keys held
                state.spinAngle += state.doubleDir * SPIN_SPEED * 2 * dt;
                // Keep spinTarget just ahead so arm-drop logic stays active
                state.spinTarget = state.spinAngle + state.doubleDir * 0.01;
            } else {
                const spinDiff = state.spinTarget - state.spinAngle;
                if (Math.abs(spinDiff) > 0.001) {
                    const spinStep = SPIN_SPEED * dt;
                    state.spinAngle += (Math.abs(spinDiff) <= spinStep)
                        ? spinDiff
                        : Math.sign(spinDiff) * spinStep;
                }
            }
        }

        // ── Arm drop: wind-up, active spin, or double mode ─────────────────
        const spinRemaining = state.spinTarget - state.spinAngle;
        // Both arms drop in double mode, on crash, or on active-side wind-up
        const armLTarget = state.crashed || (leftDown && !rightDown) || doubleMode || spinRemaining >  0.05 ? 1.0 : 0.0;
        const armRTarget = state.crashed || (rightDown && !leftDown) || doubleMode || spinRemaining < -0.05 ? 1.0 : 0.0;
        const armStep = ARM_DROP_RATE * dt;
        const dL = armLTarget - state.armDropL;
        const dR = armRTarget - state.armDropR;
        state.armDropL += Math.abs(dL) <= armStep ? dL : Math.sign(dL) * armStep;
        state.armDropR += Math.abs(dR) <= armStep ? dR : Math.sign(dR) * armStep;

        // ── Apply body pose ────────────────────────────────────────────────
        applyPose(character.meshes, state.tuckAmount, state.armDropL, state.armDropR);

        // ── Camera follow ──────────────────────────────────────────────────
        camera.target.y = state.rootY;
        camera.target.z = state.posZ;

        // ── Character rotation ─────────────────────────────────────────────
        // qFace turns the character to face +Z (downhill direction).
        const qFace = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, Math.PI);
        if (state.grounded) {
            let tilt = 0;
            if (state.posZ >= 0 && state.posZ < KICKER_Z)                    tilt = -SLOPE_ANGLE;
            else if (state.posZ >= KICKER_Z && state.posZ <= KICKER_END_Z)   tilt = KICKER_ANGLE;
            else if (state.posZ > KICKER_END_Z)                               tilt = -LANDING_ANGLE;
            const qTilt  = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, tilt);
            const qCrash = state.crashed
                ? BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, state.flipAngle)
                : BABYLON.Quaternion.Identity();
            character.root.rotationQuaternion = qFace.multiply(qTilt).multiply(qCrash);
        } else {
            // qFlip * qSpin — spin in body-local space (head-to-feet axis)
            const qFlip = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, state.flipAngle);
            const qSpin = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, state.spinAngle);
            character.root.rotationQuaternion = qFace.multiply(qFlip).multiply(qSpin);
        }

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
            `Spin angle : ${(state.spinAngle  / (Math.PI * 2)).toFixed(2)} rev`,
            `Spin target: ${(state.spinTarget / (Math.PI * 2)).toFixed(2)} rev`,
        ].join('\n');
    });

    // ── Run ───────────────────────────────────────────────────────────────────
    engine.runRenderLoop(() => scene.render());
});
