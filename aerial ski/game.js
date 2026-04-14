'use strict';

// ── Colour helpers ─────────────────────────────────────────────────────────
function _hexToRgb(hex) {
    var r = parseInt(hex.slice(1,3),16)/255;
    var g = parseInt(hex.slice(3,5),16)/255;
    var b = parseInt(hex.slice(5,7),16)/255;
    return [r, g, b];
}
const _CC = {
    helmet: _hexToRgb(localStorage.getItem('color_helmet') || '#1a1a1a'),
    torso:  _hexToRgb(localStorage.getItem('color_torso')  || '#1440bf'),
    arms:   _hexToRgb(localStorage.getItem('color_arms')   || '#cc0f0f'),
    legs:   _hexToRgb(localStorage.getItem('color_legs')   || '#1a1a1a'),
};

// ── Segment definitions ────────────────────────────────────────────────────
// Each segment has a name, box size (w × h × d), and mass (arbitrary units,
// proportional to a real athlete — ratios are what matter for physics).
const SEGMENTS = [
    { name: 'torso',     w: 0.30, h: 0.55, d: 0.28, mass: 22.0, color: _CC.torso  },
    { name: 'head',      w: 0.22, h: 0.24, d: 0.24, mass:  6.0, color: _CC.helmet },
    { name: 'upperArmL', w: 0.11, h: 0.30, d: 0.11, mass:  2.5, color: _CC.arms   },
    { name: 'upperArmR', w: 0.11, h: 0.30, d: 0.11, mass:  2.5, color: _CC.arms   },
    { name: 'lowerArmL', w: 0.09, h: 0.25, d: 0.09, mass:  1.5, color: _CC.arms   },
    { name: 'lowerArmR', w: 0.09, h: 0.25, d: 0.09, mass:  1.5, color: _CC.arms   },
    { name: 'upperLegL', w: 0.13, h: 0.36, d: 0.18, mass:  7.0, color: _CC.legs   },
    { name: 'upperLegR', w: 0.13, h: 0.36, d: 0.18, mass:  7.0, color: _CC.legs   },
    { name: 'lowerLegL', w: 0.11, h: 0.36, d: 0.14, mass:  5.0, color: _CC.legs   },
    { name: 'lowerLegR', w: 0.11, h: 0.36, d: 0.14, mass:  5.0, color: _CC.legs   },
    // Skis: long (≈ leg length), thin, flat — centered under each foot
    { name: 'skiL',      w: 0.08, h: 0.03, d: 1.20, mass:  2.0, color: [0.08, 0.08, 0.08] },
    { name: 'skiR',      w: 0.08, h: 0.03, d: 1.20, mass:  2.0, color: [0.08, 0.08, 0.08] },
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
    upperArmL:  0.008, upperArmR: -0.008,
    lowerArmL:  0.008, lowerArmR: -0.008,
    upperLegL:  0.008, upperLegR: -0.008,
    lowerLegL:  0.008, lowerLegR: -0.008,
    skiL:       0.008, skiR:      -0.008,
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

// Inrun crouch: egg/tuck position — torso leans forward over knees.  Root is lowered
// 0.35 units when fully tucked, so ski y is set to -0.675 (= -1.010 + 0.35).
const POSE_INRUN_TUCK = {
    torso:     { x:  0.000, y:  0.000, rx: -1.10, rz:  0.00, dz: -0.10 },  // torso tips forward
    head:      { x:  0.000, y:  0.160, rx: -1.00, rz:  0.00, dz: -0.45 },  // head drives forward/down
    upperArmL: { x: -0.205, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperArmR: { x:  0.205, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmL: { x: -0.205, y: -0.275, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmR: { x:  0.205, y: -0.275, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperLegL: { x: -0.075, y: -0.240, rx:  0.85, rz:  0.00, dz:  0.15 },  // thighs push back
    upperLegR: { x:  0.075, y: -0.240, rx:  0.85, rz:  0.00, dz:  0.15 },
    lowerLegL: { x: -0.075, y: -0.490, rx: -0.40, rz:  0.00, dz:  0.05 },  // shins tilt forward
    lowerLegR: { x:  0.075, y: -0.490, rx: -0.40, rz:  0.00, dz:  0.05 },
    skiL:      { x: -0.075, y: -0.660, rx:  0.00, rz:  0.00, dz:  0.00 },
    skiR:      { x:  0.075, y: -0.660, rx:  0.00, rz:  0.00, dz:  0.00 },
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
// Arms angled 50° forward from vertical, straight (no elbow bend).
// rx = -50° = -0.873 rad. Shoulder at y=0.15, arm points forward-down.
const POSE_ARMS_50DEG = {
    upperArmL: { x: -0.205, y:  0.054, rx: -0.873, rz:  0.00, dz: -0.115 },
    upperArmR: { x:  0.205, y:  0.054, rx: -0.873, rz:  0.00, dz: -0.115 },
    lowerArmL: { x: -0.205, y: -0.123, rx: -0.873, rz:  0.00, dz: -0.326 },
    lowerArmR: { x:  0.205, y: -0.123, rx: -0.873, rz:  0.00, dz: -0.326 },
};
// T-pose: arms straight out to the sides.
// rz = +π/2 (left arm), rz = -π/2 (right arm).
const POSE_ARMS_T = {
    upperArmL: { x: -0.355, y:  0.150, rx: 0.00, rz:  1.57, dz:  0.00 },
    upperArmR: { x:  0.355, y:  0.150, rx: 0.00, rz: -1.57, dz:  0.00 },
    lowerArmL: { x: -0.580, y:  0.150, rx: 0.00, rz:  1.57, dz:  0.00 },
    lowerArmR: { x:  0.580, y:  0.150, rx: 0.00, rz: -1.57, dz:  0.00 },
};
// Arms raised straight up overhead.
const POSE_ARMS_UP = {
    upperArmL: { x: -0.205, y:  0.450, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperArmR: { x:  0.205, y:  0.450, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmL: { x: -0.205, y:  0.725, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmR: { x:  0.205, y:  0.725, rx:  0.00, rz:  0.00, dz:  0.00 },
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
                tessellation:   18,
            }, scene);
        } else if (n === 'skiL' || n === 'skiR') {
            // Skis remain flat boxes
            mesh = BABYLON.MeshBuilder.CreateBox(n, {
                width:  seg.w,
                height: seg.h,
                depth:  seg.d,
            }, scene);
        } else if (n === 'upperLegL' || n === 'upperLegR') {
            // Thigh — wide at hip, tapers to knee
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameterTop:    0.175,
                diameterBottom: 0.115,
                height:         seg.h,
                tessellation:   18,
            }, scene);
        } else if (n === 'lowerLegL' || n === 'lowerLegR') {
            // Calf — full at top, tapers to ankle
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameterTop:    0.135,
                diameterBottom: 0.080,
                height:         seg.h,
                tessellation:   18,
            }, scene);
        } else if (n === 'upperArmL' || n === 'upperArmR') {
            // Upper arm — wider at shoulder, tapers to elbow
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameterTop:    0.120,
                diameterBottom: 0.090,
                height:         seg.h,
                tessellation:   18,
            }, scene);
        } else if (n === 'lowerArmL' || n === 'lowerArmR') {
            // Forearm — wider at elbow, tapers to wrist
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameterTop:    0.095,
                diameterBottom: 0.065,
                height:         seg.h,
                tessellation:   18,
            }, scene);
        } else {
            // Fallback — rounded cylinder
            const diam = (seg.w + seg.d) / 2;
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameter:     diam,
                height:       seg.h,
                tessellation: 18,
            }, scene);
        }

        mesh.parent = root;

        const mat = new BABYLON.StandardMaterial(n + '_mat', scene);
        mat.diffuseColor  = new BABYLON.Color3(seg.color[0], seg.color[1], seg.color[2]);
        // Lycra/spandex sheen on suit panels; matte on skis
        const isSki = (n === 'skiL' || n === 'skiR');
        mat.specularColor = isSki ? new BABYLON.Color3(0.15, 0.15, 0.15) : new BABYLON.Color3(0.65, 0.65, 0.65);
        mat.specularPower = isSki ? 12 : 55;
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

            // Nose bump below visor
            const nose = BABYLON.MeshBuilder.CreateSphere('nose', {
                diameter: seg.h * 0.24,
                segments: 6,
            }, scene);
            nose.parent = mesh;
            nose.scaling.set(0.65, 0.55, 1.1);
            nose.position.set(0, -seg.h * 0.12, -seg.h * 0.45);
            const nMat = new BABYLON.StandardMaterial('nose_mat', scene);
            nMat.diffuseColor  = new BABYLON.Color3(0.85, 0.72, 0.60);
            nMat.specularColor = new BABYLON.Color3(0.20, 0.15, 0.12);
            nose.material = nMat;
        }

        if (n === 'torso') {
            // Neck — cylinder bridging torso top to head
            const neck = BABYLON.MeshBuilder.CreateCylinder('neck', {
                diameterTop:    0.11,
                diameterBottom: 0.13,
                height:         0.09,
                tessellation:   14,
            }, scene);
            neck.parent = mesh;
            neck.position.set(0, seg.h * 0.5 + 0.045, 0);
            const nkMat = new BABYLON.StandardMaterial('neck_mat', scene);
            nkMat.diffuseColor  = new BABYLON.Color3(0.85, 0.72, 0.60);
            nkMat.specularColor = new BABYLON.Color3(0.20, 0.15, 0.12);
            nkMat.specularPower = 18;
            neck.material = nkMat;
        }

        if (n === 'upperArmL' || n === 'upperArmR') {
            // Shoulder sphere — fills gap between torso and upper arm
            const shoulder = BABYLON.MeshBuilder.CreateSphere(n + '_shoulder', {
                diameter: 0.13,
                segments: 8,
            }, scene);
            shoulder.parent = mesh;
            shoulder.position.set(0, seg.h * 0.5, 0);
            const sMat = new BABYLON.StandardMaterial(n + '_shoulder_mat', scene);
            sMat.diffuseColor  = new BABYLON.Color3(_CC.arms[0], _CC.arms[1], _CC.arms[2]);
            sMat.specularColor = new BABYLON.Color3(0.55, 0.20, 0.20);
            sMat.specularPower = 55;
            shoulder.material = sMat;
        }

        if (n === 'lowerArmL' || n === 'lowerArmR') {
            // Elbow sphere — fills gap between upper and lower arm
            const elbow = BABYLON.MeshBuilder.CreateSphere(n + '_elbow', {
                diameter: 0.060,
                segments: 8,
            }, scene);
            elbow.scaling.set(1.0, 0.70, 1.0); // flatten slightly — elbows aren't round balls
            elbow.parent = mesh;
            elbow.position.set(0, seg.h * 0.5, 0);
            const eMat = new BABYLON.StandardMaterial(n + '_elbow_mat', scene);
            eMat.diffuseColor  = new BABYLON.Color3(_CC.arms[0], _CC.arms[1], _CC.arms[2]);
            eMat.specularColor = new BABYLON.Color3(0.55, 0.20, 0.20);
            eMat.specularPower = 55;
            elbow.material = eMat;

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

        if (n === 'upperLegL' || n === 'upperLegR') {
            // Hip sphere — fills gap between torso and upper leg
            const hip = BABYLON.MeshBuilder.CreateSphere(n + '_hip', {
                diameter: 0.17,
                segments: 8,
            }, scene);
            hip.parent = mesh;
            hip.position.set(0, seg.h * 0.5, 0);
            const hipMat = new BABYLON.StandardMaterial(n + '_hip_mat', scene);
            hipMat.diffuseColor  = new BABYLON.Color3(0.10, 0.10, 0.10);
            hipMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
            hipMat.specularPower = 35;
            hip.material = hipMat;
        }

        if (n === 'lowerLegL' || n === 'lowerLegR') {
            // Knee sphere — fills gap between upper and lower leg
            const knee = BABYLON.MeshBuilder.CreateSphere(n + '_knee', {
                diameter: 0.13,
                segments: 8,
            }, scene);
            knee.parent = mesh;
            knee.position.set(0, seg.h * 0.5, 0);
            const knMat = new BABYLON.StandardMaterial(n + '_knee_mat', scene);
            knMat.diffuseColor  = new BABYLON.Color3(0.10, 0.10, 0.10);
            knMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
            knMat.specularPower = 35;
            knee.material = knMat;

            // Ski boot — two-piece: lower shell + upper cuff
            // Lower shell (hard outer sole/toe box)
            const bootLower = BABYLON.MeshBuilder.CreateBox(n + '_bootLower', {
                width:  seg.w * 1.55,
                height: seg.h * 0.22,
                depth:  seg.d * 1.55,
            }, scene);
            bootLower.parent = mesh;
            bootLower.position.set(0, -seg.h * 0.42, seg.d * 0.12);
            const blMat = new BABYLON.StandardMaterial(n + '_bootLower_mat', scene);
            blMat.diffuseColor  = new BABYLON.Color3(0.12, 0.10, 0.09);
            blMat.specularColor = new BABYLON.Color3(0.55, 0.50, 0.45);
            blMat.specularPower = 60;
            bootLower.material = blMat;

            // Upper cuff (tall plastic shell wrapping the shin)
            const bootCuff = BABYLON.MeshBuilder.CreateCylinder(n + '_bootCuff', {
                diameterTop:    seg.w * 1.35,
                diameterBottom: seg.w * 1.55,
                height:         seg.h * 0.38,
                tessellation:   14,
            }, scene);
            bootCuff.parent = mesh;
            bootCuff.position.set(0, -seg.h * 0.22, 0);
            const bcMat = new BABYLON.StandardMaterial(n + '_bootCuff_mat', scene);
            bcMat.diffuseColor  = new BABYLON.Color3(0.58, 0.08, 0.06);
            bcMat.specularColor = new BABYLON.Color3(0.55, 0.30, 0.28);
            bcMat.specularPower = 45;
            bootCuff.material = bcMat;

            // Buckle strip — thin black band across the cuff
            const buckle = BABYLON.MeshBuilder.CreateBox(n + '_buckle', {
                width:  seg.w * 1.65,
                height: seg.h * 0.04,
                depth:  seg.d * 0.05,
            }, scene);
            buckle.parent = mesh;
            buckle.position.set(0, -seg.h * 0.16, -seg.d * 0.70);
            const buMat = new BABYLON.StandardMaterial(n + '_buckle_mat', scene);
            buMat.diffuseColor  = new BABYLON.Color3(0.80, 0.78, 0.72);
            buMat.specularColor = new BABYLON.Color3(0.90, 0.88, 0.82);
            buMat.specularPower = 90;
            buckle.material = buMat;
        }
    }

    return { root, meshes };
}

// Arc-based arm drop: arm rotates in the sagittal (Y-Z) plane around the shoulder
// joint, sweeping straight forward in front of the body and then down.
// Character faces -Z, so forward = negative dz.
// t = 0: arm raised straight up.  t = 1: arm hanging straight down.
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
// tuck:     0 = fully extended, 1 = fully tucked
// armDropL: 0 = left arm raised, 1 = left arm dropped to side
// armDropR: 0 = right arm raised, 1 = right arm dropped to side
// armSnap:  0-1, blends arms toward POSE_ARMS_50DEG (overrides armDrop for arm segments)
// arguments[7] = grounded: true → use POSE_INRUN_TUCK, false → use POSE_TUCKED
function applyPose(meshes, tuck, armDropL, armDropR, armSnap) {
    const grounded = arguments[7];
    for (const seg of SEGMENTS) {
        const mesh = meshes[seg.name];
        const up   = POSE_UNTUCKED[seg.name];
        const tk   = (grounded ? POSE_INRUN_TUCK : POSE_TUCKED)[seg.name];
        let ex = up;

        if (seg.name === 'upperArmL' || seg.name === 'lowerArmL') {
            ex = armSweep(seg.name, up, armDropL);
            if (armSnap > 0) {
                const sn = POSE_ARMS_50DEG[seg.name];
                ex = { x: lerp(ex.x, sn.x, armSnap), y: lerp(ex.y, sn.y, armSnap),
                       rx: lerp(ex.rx, sn.rx, armSnap), rz: lerp(ex.rz, sn.rz, armSnap),
                       dz: lerp(ex.dz, sn.dz, armSnap) };
            }
            if (arguments[5] > 0) { // layArmT
                const tp = POSE_ARMS_T[seg.name];
                ex = { x: lerp(ex.x, tp.x, arguments[5]), y: lerp(ex.y, tp.y, arguments[5]),
                       rx: lerp(ex.rx, tp.rx, arguments[5]), rz: lerp(ex.rz, tp.rz, arguments[5]),
                       dz: lerp(ex.dz, tp.dz, arguments[5]) };
            }
            if (arguments[6] > 0) { // armRaise
                const up2 = POSE_ARMS_UP[seg.name];
                const raiseT = arguments[6] * (1 - armDropL);
                ex = { x: lerp(ex.x, up2.x, raiseT), y: lerp(ex.y, up2.y, raiseT),
                       rx: lerp(ex.rx, up2.rx, raiseT), rz: lerp(ex.rz, up2.rz, raiseT),
                       dz: lerp(ex.dz, up2.dz, raiseT) };
            }
        } else if (seg.name === 'upperArmR' || seg.name === 'lowerArmR') {
            ex = armSweep(seg.name, up, armDropR);
            if (armSnap > 0) {
                const sn = POSE_ARMS_50DEG[seg.name];
                ex = { x: lerp(ex.x, sn.x, armSnap), y: lerp(ex.y, sn.y, armSnap),
                       rx: lerp(ex.rx, sn.rx, armSnap), rz: lerp(ex.rz, sn.rz, armSnap),
                       dz: lerp(ex.dz, sn.dz, armSnap) };
            }
            if (arguments[5] > 0) { // layArmT
                const tp = POSE_ARMS_T[seg.name];
                ex = { x: lerp(ex.x, tp.x, arguments[5]), y: lerp(ex.y, tp.y, arguments[5]),
                       rx: lerp(ex.rx, tp.rx, arguments[5]), rz: lerp(ex.rz, tp.rz, arguments[5]),
                       dz: lerp(ex.dz, tp.dz, arguments[5]) };
            }
            if (arguments[6] > 0) { // armRaise
                const up2 = POSE_ARMS_UP[seg.name];
                const raiseT = arguments[6] * (1 - armDropR);
                ex = { x: lerp(ex.x, up2.x, raiseT), y: lerp(ex.y, up2.y, raiseT),
                       rx: lerp(ex.rx, up2.rx, raiseT), rz: lerp(ex.rz, up2.rz, raiseT),
                       dz: lerp(ex.dz, up2.dz, raiseT) };
            }
        }

        mesh.position.x = lerp(ex.x,  tk.x,  tuck);
        mesh.position.y = lerp(ex.y,  tk.y,  tuck);
        mesh.position.z = (BASE_Z[seg.name] || 0) + lerp(ex.dz, tk.dz, tuck);
        mesh.rotation.x = lerp(ex.rx, tk.rx, tuck);
        mesh.rotation.z = lerp(ex.rz, tk.rz, tuck);
    }

    // ── Reposition gloves to always sit at the wrist ───────────────────────
    // With the arc-based arm drop the local +Y axis always points along the arm
    // toward the wrist end, so the glove stays fixed at +halfH during any drop.
    // Only during tuck (arm folds forward with rx≠0) do we slide it toward the
    // elbow so it doesn't poke through the knees.
    if (meshes.gloveL) {
        meshes.gloveL.mesh.position.y = lerp(meshes.gloveL.halfH, -meshes.gloveL.halfH, tuck);
    }
    if (meshes.gloveR) {
        meshes.gloveR.mesh.position.y = lerp(meshes.gloveR.halfH, -meshes.gloveR.halfH, tuck);
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
    hint.text       = '';
    hint.isVisible  = false;
    hint.resizeToFit = true;
    ui.addControl(hint);

    return { hud, hint };
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
const _worldParam   = new URLSearchParams(location.search).get('world') || 'double';
const _compParam    = new URLSearchParams(location.search).get('comp');  // null | 'easy' | 'medium' | 'hard' | 'ultra'
const _olympicsMode = new URLSearchParams(location.search).get('olympics'); // null | 'qual' | 'finals'
const _ultraJump    = _compParam === 'ultra' ? Math.max(0, parseInt(new URLSearchParams(location.search).get('ultrajump') || '0', 10)) : 0;
const _customInrun    = _worldParam === 'custom' ? Math.max(4, Math.min(100, parseFloat(new URLSearchParams(location.search).get('inrun')    || '11'))) : 0;
const _customLanding  = _worldParam === 'custom' ? Math.max(20, Math.min(150, parseFloat(new URLSearchParams(location.search).get('landing')  || '50'))) : 0;
const _customFlipSpeed = _worldParam === 'custom' ? Math.max(0.3, Math.min(3.0, parseFloat(new URLSearchParams(location.search).get('flipspeed') || '1.3'))) : 1.0;
const OUTRUN_Z      = _worldParam === 'custom' ? KICKER_END_Z + _customLanding : KICKER_END_Z + (_worldParam === 'quint' ? 75 : 50); // landing slope ends here
const FLAT_Z        = KICKER_Z - 9.0; // flat table starts before kicker
const SLOPE_START_Z = _worldParam === 'custom' ? -_customInrun : _worldParam === 'quint' ? -43.0 : _worldParam === 'quad' ? -33.8 : _worldParam === 'triple' ? -19.8 : _worldParam === 'single' ? -4.3 : -11.3;


function terrainRootY(z) {
    if (z < SLOPE_START_Z) return -SLOPE_START_Z * Math.tan(SLOPE_ANGLE); // flat top
    if (z < FLAT_Z) return -z * Math.tan(SLOPE_ANGLE);
    const tableY = -FLAT_Z * Math.tan(SLOPE_ANGLE); // height of flat table
    if (z < KICKER_Z) return tableY; // flat table
    if (z <= KICKER_END_Z) {
        return tableY + (z - KICKER_Z) * Math.tan(KICKER_ANGLE); // kicker rises from table
    }
    const kickerTopY = tableY + (KICKER_END_Z - KICKER_Z) * Math.tan(KICKER_ANGLE);
    const landingBaseY = kickerTopY - LANDING_DROP;
    if (z <= OUTRUN_Z) return landingBaseY - (z - KICKER_END_Z) * Math.tan(LANDING_ANGLE);
    const outrunY = landingBaseY - (OUTRUN_Z - KICKER_END_Z) * Math.tan(LANDING_ANGLE);
    return outrunY; // flat outrun
}

function terrainAccelZ(z) {
    const g = 14.0;
    if (z >= SLOPE_START_Z && z < FLAT_Z)   return g * Math.sin(SLOPE_ANGLE);
    if (z < SLOPE_START_Z)                   return 0; // flat top
    if (z >= FLAT_Z && z < KICKER_Z)      return 0; // flat table
    if (z >= KICKER_Z && z <= KICKER_END_Z) return -g * Math.sin(KICKER_ANGLE);
    if (z > KICKER_END_Z && z <= OUTRUN_Z) return g * Math.sin(LANDING_ANGLE);
    if (z > OUTRUN_Z) return -14.0; // flat outrun friction
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

    function setOrtho(halfH = 3.0) {
        const w = engine.getRenderWidth();
        const h = engine.getRenderHeight();
        camera.orthoTop    =  halfH;
        camera.orthoBottom = -halfH;
        camera.orthoLeft   = -halfH * (w / h);
        camera.orthoRight  =  halfH * (w / h);
    }
    setOrtho();
    window.addEventListener('resize', () => { engine.resize(); if (!cameraFollow) setOrtho(3.0); });

    // ── Lighting ─────────────────────────────────────────────────────────────
    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.4, 1, -0.8), scene);
    hemi.intensity   = 1.0;
    hemi.groundColor = new BABYLON.Color3(0.2, 0.2, 0.3); // subtle cool fill from below

    // ── Depth of field pipeline (active only in behind-character view) ────────
    const dofPipeline = new BABYLON.DefaultRenderingPipeline('dof', true, scene, [camera]);
    dofPipeline.depthOfFieldEnabled  = false;
    dofPipeline.depthOfFieldBlurLevel = BABYLON.DepthOfFieldEffectBlurLevel.Medium;
    dofPipeline.depthOfField.fStop        = 1.4;
    dofPipeline.depthOfField.focalLength  = 50;   // mm — tighter focus
    dofPipeline.depthOfField.focusDistance = 10000; // mm — distance to character (~10 world units)

    // ── Character ─────────────────────────────────────────────────────────────
    const character = buildCharacter(scene);
    applyPose(character.meshes, 0, 1, 1); // start fully extended, arms down
    window._characterMeshes = character.meshes;

    window.applySkierColors = function() {
        function hexToC3(hex) {
            return new BABYLON.Color3(
                parseInt(hex.slice(1,3),16)/255,
                parseInt(hex.slice(3,5),16)/255,
                parseInt(hex.slice(5,7),16)/255
            );
        }
        var m = window._characterMeshes;
        if (!m) return;
        var helmetC = hexToC3(localStorage.getItem('color_helmet') || '#1a1a1a');
        var torsoC  = hexToC3(localStorage.getItem('color_torso')  || '#1440bf');
        var armsC   = hexToC3(localStorage.getItem('color_arms')   || '#cc0f0f');
        var legsC   = hexToC3(localStorage.getItem('color_legs')   || '#1a1a1a');
        if (m['head']  && m['head'].material)  m['head'].material.diffuseColor  = helmetC;
        if (m['torso'] && m['torso'].material) m['torso'].material.diffuseColor = torsoC;
        ['upperArmL','upperArmR','lowerArmL','lowerArmR'].forEach(function(n) {
            if (m[n] && m[n].material) m[n].material.diffuseColor = armsC;
        });
        ['upperLegL','upperLegR','lowerLegL','lowerLegR'].forEach(function(n) {
            if (m[n] && m[n].material) m[n].material.diffuseColor = legsC;
        });
        // shoulder/elbow/glove detail meshes — walk all scene meshes by name
        scene.meshes.forEach(function(mesh) {
            if (!mesh.material) return;
            var n = mesh.name;
            if (n.indexOf('shoulder') !== -1 || n.indexOf('elbow') !== -1 || n.indexOf('glove') !== -1)
                mesh.material.diffuseColor = armsC;
        });
    };

    // ── Terrain meshes (visual — physics uses terrainRootY()) ────────────────────
    const snowMat = new BABYLON.StandardMaterial('snowMat', scene);
    snowMat.diffuseColor = new BABYLON.Color3(0.92, 0.97, 1.0);

    // Main slope (SLOPE_START_Z to FLAT_Z)
    const slopeBox = BABYLON.MeshBuilder.CreateBox('slope',
        { width: 10, height: 1.2, depth: (FLAT_Z - SLOPE_START_Z) / Math.cos(SLOPE_ANGLE) }, scene);
    slopeBox.rotation.x = SLOPE_ANGLE;
    slopeBox.position.set(0, terrainRootY((SLOPE_START_Z + FLAT_Z) / 2) - FOOT_OFFSET - 0.6, (SLOPE_START_Z + FLAT_Z) / 2);
    slopeBox.material = snowMat;

    // Transition wedge — smooths corner between slope and flat table (visual only)
    const TRANS_LEN   = 2.0; // world-units long
    const TRANS_ANGLE = SLOPE_ANGLE / 2;
    const transOffset = -1.25; // shift away from kicker
    const transMidZ   = FLAT_Z + transOffset + TRANS_LEN / 2;
    const transBox = BABYLON.MeshBuilder.CreateBox('transition',
        { width: 10, height: 1.2, depth: TRANS_LEN / Math.cos(TRANS_ANGLE) }, scene);
    transBox.rotation.x = TRANS_ANGLE;
    transBox.position.set(0, terrainRootY(FLAT_Z) - FOOT_OFFSET - 0.6 / Math.cos(TRANS_ANGLE) + 0.15, transMidZ);
    transBox.material = snowMat;

    // Flat table before kicker (~20 ft)
    const flatTableMidZ = (FLAT_Z + KICKER_Z) / 2;
    const flatTableBox = BABYLON.MeshBuilder.CreateBox('flatTable',
        { width: 10, height: 1.2, depth: KICKER_Z - FLAT_Z }, scene);
    flatTableBox.position.set(0, terrainRootY(flatTableMidZ) - FOOT_OFFSET - 0.6, flatTableMidZ);
    flatTableBox.material = snowMat;

    // Kicker
    const kickerBox = BABYLON.MeshBuilder.CreateBox('kicker',
        { width: 3, height: 1.2, depth: (KICKER_END_Z - KICKER_Z) / Math.cos(KICKER_ANGLE) }, scene);
    kickerBox.rotation.x = -KICKER_ANGLE;
    kickerBox.position.set(0,
        terrainRootY((KICKER_Z + KICKER_END_Z) / 2) - FOOT_OFFSET - 0.6,
        (KICKER_Z + KICKER_END_Z) / 2);
    kickerBox.material = snowMat;

    // Kicker transition wedge — smooths corner between flat table and kicker (visual only)
    const KTRANS_LEN   = 2.0;
    const KTRANS_ANGLE = KICKER_ANGLE / 2;
    const ktransOffset = -0.8; // adjust to align visually
    const ktransMidZ   = KICKER_Z + ktransOffset + KTRANS_LEN / 2;
    const ktransBox = BABYLON.MeshBuilder.CreateBox('kickerTransition',
        { width: 3, height: 1.2, depth: KTRANS_LEN / Math.cos(KTRANS_ANGLE) }, scene);
    ktransBox.rotation.x = -KTRANS_ANGLE;
    ktransBox.position.set(0, terrainRootY(KICKER_Z) - FOOT_OFFSET - 0.6 / Math.cos(KTRANS_ANGLE) + 0.4, ktransMidZ);
    ktransBox.material = snowMat;

    // Kicker top-edge arc (red tube spanning the full width)
    const cornerMat = new BABYLON.StandardMaterial('cornerMat', scene);
    cornerMat.diffuseColor  = new BABYLON.Color3(1, 0, 0);
    cornerMat.emissiveColor = new BABYLON.Color3(0.8, 0, 0);
    const kickerTopY = terrainRootY(KICKER_END_Z);
    const arcHalfW   = 1.5;   // half the kicker width (3 units total)
    const baseY      = kickerTopY + 0.11 - 2;
    // Drops follow the kicker face angle rather than straight down
    const dropDY = -Math.sin(KICKER_ANGLE);  // y component of 1-unit drop along kicker face
    const dropDZ = -Math.cos(KICKER_ANGLE);  // z component
    const arcPath    = [
        new BABYLON.Vector3(-arcHalfW, baseY + dropDY + 0.6, KICKER_END_Z - 0.5 + dropDZ),  // bottom of left drop
        new BABYLON.Vector3(-arcHalfW, baseY          + 0.6, KICKER_END_Z - 0.5),            // top-left corner
        new BABYLON.Vector3(-0.5,      baseY          + 0.6, KICKER_END_Z - 0.5),            // inner end of left segment
    ];
    const arcTube = BABYLON.MeshBuilder.CreateTube('kickerArc',
        { path: arcPath, radius: 0.06, tessellation: 8, cap: BABYLON.Mesh.CAP_ALL }, scene);
    arcTube.material = cornerMat;
    const arcPathR   = [
        new BABYLON.Vector3( 0.5,      baseY          + 0.6, KICKER_END_Z - 0.5),            // inner end of right segment
        new BABYLON.Vector3( arcHalfW, baseY          + 0.6, KICKER_END_Z - 0.5),            // top-right corner
        new BABYLON.Vector3( arcHalfW, baseY + dropDY + 0.6, KICKER_END_Z - 0.5 + dropDZ),  // bottom of right drop
    ];
    const arcTubeR = BABYLON.MeshBuilder.CreateTube('kickerArcR',
        { path: arcPathR, radius: 0.06, tessellation: 8, cap: BABYLON.Mesh.CAP_ALL }, scene);
    arcTubeR.material = cornerMat;

    // Sloped landing zone
    const landingMidZ = (KICKER_END_Z + OUTRUN_Z) / 2;
    const landingDepth = OUTRUN_Z - KICKER_END_Z;
    const landingBox = BABYLON.MeshBuilder.CreateBox('landing',
        { width: 10, height: 1.2, depth: landingDepth / Math.cos(LANDING_ANGLE) }, scene);
    landingBox.rotation.x = LANDING_ANGLE;
    landingBox.position.set(0, terrainRootY(landingMidZ) - FOOT_OFFSET - 0.6 / Math.cos(LANDING_ANGLE), landingMidZ);
    landingBox.material = snowMat;

    // Flat outrun (90 units long)
    const OUTRUN_LEN  = 90;
    const outrunMidZ  = OUTRUN_Z + OUTRUN_LEN / 2;
    const outrunBox = BABYLON.MeshBuilder.CreateBox('outrun',
        { width: 10, height: 1.2, depth: OUTRUN_LEN }, scene);
    outrunBox.position.set(0, terrainRootY(OUTRUN_Z) - FOOT_OFFSET - 0.6, outrunMidZ);
    outrunBox.material = snowMat;


    // Flat start area (behind slope start)
    const startBox = BABYLON.MeshBuilder.CreateBox('start',
        { width: 10, height: 1.2, depth: 20 }, scene);
    startBox.position.set(0, -FOOT_OFFSET - 0.6, SLOPE_START_Z - 9);
    startBox.material = snowMat;

    // ── Background trees ──────────────────────────────────────────────────────
    {
    const trunkMat = new BABYLON.StandardMaterial('trunkMat', scene);
    trunkMat.diffuseColor = new BABYLON.Color3(0.38, 0.24, 0.14);
    const foliageMat = new BABYLON.StandardMaterial('foliageMat', scene);
    foliageMat.diffuseColor = new BABYLON.Color3(0.13, 0.38, 0.18);

    const treeBaseY = terrainRootY(OUTRUN_Z) - FOOT_OFFSET;
    const treePositions = [
        { z: OUTRUN_Z + 5,  x: 3.5, scale: 1.0 },
        { z: OUTRUN_Z + 15, x: 4.5, scale: 1.3 },
        { z: OUTRUN_Z + 28, x: 3.0, scale: 0.9 },
        { z: OUTRUN_Z + 40, x: 5.0, scale: 1.2 },
        { z: OUTRUN_Z + 52, x: 3.8, scale: 1.1 },
        { z: OUTRUN_Z + 63, x: 4.2, scale: 1.4 },
        { z: OUTRUN_Z + 74, x: 3.2, scale: 0.85 },
        { z: KICKER_END_Z + 10, x: 4.0, scale: 1.0 },
        { z: KICKER_END_Z + 22, x: 5.2, scale: 1.2 },
    ];
    treePositions.forEach(function(t, i) {
        const trunkH = 0.7 * t.scale;
        const trunkR = 0.12 * t.scale;
        const foliageH = 1.8 * t.scale;
        const foliageR = 0.65 * t.scale;

        const trunk = BABYLON.MeshBuilder.CreateCylinder('tree_trunk_' + i,
            { height: trunkH, diameter: trunkR * 2, tessellation: 6 }, scene);
        trunk.position.set(t.x, treeBaseY + trunkH / 2, t.z);
        trunk.material = trunkMat;

        const foliage = BABYLON.MeshBuilder.CreateCylinder('tree_foliage_' + i,
            { height: foliageH, diameterTop: 0, diameterBottom: foliageR * 2, tessellation: 7 }, scene);
        foliage.position.set(t.x, treeBaseY + trunkH + foliageH / 2, t.z);
        foliage.material = foliageMat;
    });
    } // end trees

    // ── Physics state ─────────────────────────────────────────────────────────
    //
    // FLIP:  L_flip = I · ω is set at takeoff and NEVER changes in the air.
    //        This is always a BACKFLIP — direction is fixed, cannot be reversed.
    //        Tuck changes I, so ω = L_flip / I varies, but L_flip stays constant.
    //
    // SPIN:  Separate rotation axis (Y). Can be initiated mid-air via arm drops.
    //        Stub only in Phase 1 — tracked in state, shown in HUD, not animated.
    //
    const TARGET_OMEGA_UNTUCKED = 4.5 * 0.9925 * (_worldParam === 'custom' ? _customFlipSpeed : _worldParam === 'quint' ? 1.55 : _worldParam === 'quad' ? 1.404 : _worldParam === 'triple' ? 1.3 : _worldParam === 'single' ? 0.59 : 1.0); // rad/s at full extension
    const MAX_OMEGA = 9.75;            // rad/s cap — limits tucked flip speed
    const I0 = computeI(0);            // I at tuck = 0 (fully extended)

    const SPIN_SPEED    = Math.PI * 2.0 * (_worldParam === 'custom' ? _customFlipSpeed : _worldParam === 'quint' ? 1.45 : _worldParam === 'quad' ? 1.3 : _worldParam === 'triple' ? 1.3 : _worldParam === 'single' ? 0.68 : 1.0) * (localStorage.getItem('setting_superspin') === '1' ? 2.0 : 1.0); // rad/s ~= 1.0 full twist/second
    const ARM_DROP_RATE = 4.0;            // arm transitions in ~0.25 s
    const GRAVITY       = 14.0;           // world-units / s²

    const state = {
        L_flip:     I0 * TARGET_OMEGA_UNTUCKED,
        flipAngle:  0.0,
        tuckAmount: 0.0,
        tuckTarget: 0.0,
        flipDir:    1,    // +1 = backflip, -1 = frontflip
        spinAngle:  0.0,  // current spin angle (rad)
        spinTarget: 0.0,  // target spin; each tap adds ±2π
        spinMult:   1.0,  // spin speed multiplier
        doubleDir:  1,    // +1 = left twist, -1 = right twist (used in double mode)
        armDropL:   1.0,  // 0 = raised, 1 = dropped to side
        armDropR:   1.0,
        rootY:      0.0,  // world Y of character root
        vy:         0.0,  // vertical velocity (world-units/s)
        posZ:       SLOPE_START_Z + 2.0, // start near top of inrun
        vz:         0.0,  // Z velocity — frictionless, only gravity along slope
        grounded:   true,
        crashed:    false, // true when landed badly
        crashAngle: 0.0,  // target flip angle to animate toward after crash
        stopped:    false, // true once vz reaches 0 on outrun
        // Per-flip twist tracking
        perFlipTwists:   [],   // twists done in each completed flip
        lastFlipInt:     0,    // floor(|flipAngle|/2π) at last frame
        spinAtFlipStart: 0.0,  // spinAngle when current flip began
        spinBoundaries:  [],   // spinAngle values recorded at each flip boundary
        perFlipTucked:   [],   // true for each completed flip where tuck was used
        currentFlipTucked: false, // whether tuck has been pressed in the current flip
        trickName:       '',   // computed at landing
        execution:       0,    // out of 37 at landing
        armSnap:         0.0,  // 0-1: blend toward POSE_ARMS_50DEG
        layArmT:         0.0,  // 0-1: blend arms toward T-pose during lay
        armSnapTarget:   0,
        armRaise:        0.0,  // 0-1: blend arms straight up
        armRaiseTarget:  0,
        airTime:         0.0,  // seconds in air on current jump
    };

    let leftDown        = false;
    let rightDown       = false;
    let autoSpinActive  = false;
    let armSwapPhase    = false; // true during quick arm swap at takeoff
    let armSwapDir      = 0;    // +1 = left twists (left arm was up), -1 = right twists // true while arm-up takeoff twists are running

    // ── Replay recording ───────────────────────────────────────────────────
    let replayFrames    = [];   // recorded frames from last run
    let recordingActive = false; // true while actively recording
    let replayActive    = false; // true while playing back replay
    let replayIndex     = 0;    // current frame in playback
    const replayBtn     = document.getElementById('replayBtn');
    function startRecording() {
        replayFrames    = [];
        recordingActive = true;
    }
    function stopRecording() {
        recordingActive = false;
        if (replayBtn) replayBtn.disabled = replayFrames.length === 0;
    }
    function recordFrame() {
        replayFrames.push({
            posZ:       state.posZ,
            rootY:      state.rootY,
            flipAngle:  state.flipAngle,
            spinAngle:  state.spinAngle,
            tuckAmount: state.tuckAmount,
            armDropL:   state.armDropL,
            armDropR:   state.armDropR,
            armSnap:    state.armSnap,
            layArmT:    state.layArmT,
            armRaise:   state.armRaise,
            grounded:   state.grounded,
            crashed:    state.crashed,
            readyYaw:   0,
        });
    }
    if (replayBtn) {
        replayBtn.disabled = true;
        const replaySpeedWrap = document.getElementById('replaySpeedWrap');
        const replaySpeedEl   = document.getElementById('replaySpeed');
        const replaySpeedVal  = document.getElementById('replaySpeedVal');
        if (replaySpeedEl) {
            replaySpeedEl.addEventListener('input', () => {
                if (replaySpeedVal) replaySpeedVal.textContent = parseFloat(replaySpeedEl.value).toFixed(2).replace(/\.?0+$/, '') + '×';
            });
        }
        replayBtn.addEventListener('click', () => {
            if (!replayFrames.length) return;
            replayActive = true;
            replayIndex  = 0;
            replayAccum  = 0;
            paused       = false;
            if (replaySpeedWrap) replaySpeedWrap.classList.add('visible');
        });
    }
    let replayAccum  = 0;    // fractional frame accumulator for speed control
    let leftArmHoldTime = 0;    // seconds right arrow held alone on inrun (left arm up)
    let rightArmHoldTime= 0;    // seconds left arrow held alone on inrun (right arm up)
    const ARM_HOLD_REQ  = 0.5;  // seconds arm must be up before jump
    let paused          = false;
    let cameraFollow    = true;  // C toggles: true = behind character, false = fixed side view
    let powerWrapDown   = false; // down arrow held → 1.3× spin rate
    let arrowUpDown     = false; // up arrow held mid-air → gradually slow flip
    let readyState      = true;  // true = waiting at top, character facing sideways
    let readyTurnT      = 0.0;   // 0→1: progress of turn-to-face-downhill animation
    const READY_TURN_DUR = 0.7;  // seconds to complete the turn
    let doubleMode      = false; // both keys held → continuous 2x speed spin
    let secondKeyTimer  = null;  // timeout handle; fires after hold threshold
    const DOUBLE_HOLD_MS = 180;  // ms — hold second key longer than this = double mode

    // Initialise rotationQuaternion so Babylon doesn't mix with euler rotation.
    character.root.rotationQuaternion = BABYLON.Quaternion.Identity();

    // Apply default behind-character camera immediately
    camera.alpha = -Math.PI / 2;
    camera.beta  = Math.PI / 3.2 - 2 * Math.PI / 180;
    camera.mode  = BABYLON.Camera.PERSPECTIVE_CAMERA;
    camera.fov   = 0.9;
    dofPipeline.depthOfFieldEnabled = true;


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
        if (e.code === 'KeyP') { paused = !paused; return; }
        if (e.code === 'KeyR') {
            // In competition mode, only allow reset once stopped or crashed at the bottom
            if (_compParam && !state.stopped && !state.crashed) return;
            // Olympics mode: block reset once all attempts used
            if (_olympicsMode && olympicsDone) return;
            if (_olympicsMode && !state.stopped && !state.crashed) return;
            // Ultra mode: navigate to next world or restart from beginning
            if (_compParam === 'ultra') {
                if (compLandingResult && compLandingResult.matched) {
                    const nextJump = _ultraJump + 1;
                    if (nextJump < ULTRA_POOL.length) {
                        location.href = '?world=' + ULTRA_WORLDS[nextJump] + '&comp=ultra&ultrajump=' + nextJump;
                        return;
                    }
                    // Last jump already completed — restart ultra from beginning
                    location.href = '?world=' + ULTRA_WORLDS[0] + '&comp=ultra&ultrajump=0';
                    return;
                }
                // Failed or crashed — restart ultra from beginning
                location.href = '?world=' + ULTRA_WORLDS[0] + '&comp=ultra&ultrajump=0';
                return;
            }
            // Reset to top of slope
            state.L_flip      = I0 * TARGET_OMEGA_UNTUCKED;
            state.flipAngle   = 0.0;
            state.tuckAmount  = 0.0;
            state.tuckTarget  = 0.0;
            state.flipDir     = 1;
            state.spinAngle   = 0.0;
            state.spinTarget  = 0.0;
            state.spinMult    = 1.0;
            state.armDropL    = 1.0;
            state.armDropR    = 1.0;
            state.vy          = 0.0;
            state.posZ        = SLOPE_START_Z + 2.0;
            state.vz          = 0.0;
            state.grounded    = true;
            state.crashed     = false;
            state.crashAngle  = 0.0;
            state.stopped     = false;
            state.perFlipTwists   = [];
            state.lastFlipInt     = 0;
            state.spinAtFlipStart = 0.0;
            state.spinBoundaries  = [];
            state.perFlipTucked   = [];
            state.currentFlipTucked = false;
            state.trickName   = '';
            state.execution   = 0;
            state.armSnap     = 0.0;
            state.layArmT     = 0.0;
            state.armSnapTarget = 0;
            state.airTime     = 0.0;
            leftDown = false; rightDown = false;
            autoSpinActive = false; armSwapPhase = false;
            leftArmHoldTime = 0; rightArmHoldTime = 0;
            doubleMode = false; powerWrapDown = false; arrowUpDown = false;
            flipPower = 0; pmFill.style.width = '0%';
            billboard.isVisible = false;
            compLandingResult = null;
            // Show the queued trick now that skier is back at the top
            if (_compParam && compPendingTrick) {
                compHUDEl.textContent = compHudLabel(compPendingTrick);
            }
            readyState = true; readyTurnT = 0.0;
            return;
        }
        if (e.code === 'KeyC') {
            cameraFollow = !cameraFollow;
            if (cameraFollow) {
                // Switch to behind-character view: perspective + DOF
                camera.alpha = -Math.PI / 2;
                camera.beta  = Math.PI / 3.2 - 2 * Math.PI / 180;
                camera.mode  = BABYLON.Camera.PERSPECTIVE_CAMERA;
                camera.fov   = 0.9; // ~52°
                dofPipeline.depthOfFieldEnabled = true;
            } else {
                // Return to fixed starting side view: ortho, no DOF
                camera.alpha  = Math.PI;
                camera.beta   = Math.PI / 2;
                camera.target = BABYLON.Vector3.Zero();
                camera.mode   = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
                setOrtho(3.0);
                dofPipeline.depthOfFieldEnabled = false;
            }
            return;
        }
        if (paused) return;
        // Mirror Keys setting: swap left/right arrow interpretation
        const _mirrorKeys = localStorage.getItem('setting_mirrorkeys') === '1';
        const _kcode = (_mirrorKeys && e.code === 'ArrowLeft') ? 'ArrowRight'
                     : (_mirrorKeys && e.code === 'ArrowRight') ? 'ArrowLeft'
                     : e.code;
        if (_kcode === 'Space') {
            e.preventDefault();
            if (!state.crashed) state.tuckTarget = 1.0;
        }
        if (_kcode === 'ArrowUp' || _kcode === 'ArrowDown') {
            e.preventDefault();
        }
        if (_kcode === 'ArrowDown' && !state.grounded && !state.crashed) {
            powerWrapDown = true;
        }
        if (_kcode === 'ArrowUp' && state.grounded && readyState && readyTurnT === 0.0) {
            // Begin turn-to-face-downhill animation
            readyTurnT = 0.001; // small non-zero to start animation
        }
        if (_kcode === 'ArrowUp' && !state.grounded && !state.crashed) {
            // Raise arms straight up
            state.armRaiseTarget = 1;
            arrowUpDown = true;
        }
        if (_kcode === 'ArrowLeft' && !leftDown && !state.crashed) {
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
        if (_kcode === 'ArrowRight' && !rightDown && !state.crashed) {
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
        const _mirrorKeys = localStorage.getItem('setting_mirrorkeys') === '1';
        const _kcode = (_mirrorKeys && e.code === 'ArrowLeft') ? 'ArrowRight'
                     : (_mirrorKeys && e.code === 'ArrowRight') ? 'ArrowLeft'
                     : e.code;
        if (_kcode === 'Space') state.tuckTarget = 0.0;
        if (_kcode === 'ArrowDown') powerWrapDown = false;
        if (_kcode === 'ArrowUp') arrowUpDown = false;
        if (_kcode === 'ArrowLeft' && leftDown) {
            leftDown = false;
            if (doubleMode) exitDoubleMode();
            else if (secondKeyTimer !== null) { clearTimeout(secondKeyTimer); secondKeyTimer = null; }
        }
        if (_kcode === 'ArrowRight' && rightDown) {
            rightDown = false;
            if (doubleMode) exitDoubleMode();
            else if (secondKeyTimer !== null) { clearTimeout(secondKeyTimer); secondKeyTimer = null; }
        }
    });

    // ── Scoring (FIS degree of difficulty) ──────────────────────────────────
    const DD_TABLE = {
        // Singles
        '0':1.70, '1':2.00, '2':2.30, '3':2.60,
        // Doubles
        '0,0':2.10,
        '0,1':2.50, '1,0':2.50,
        '1,1':3.15,
        '0,2':3.00, '2,0':3.00,
        '1,2':3.50, '2,1':3.50,
        '2,2':4.00,
        '0,3':3.30, '3,0':3.30,
        '1,3':3.80, '3,1':3.80,
        '2,3':4.30, '3,2':4.30,
        '3,3':4.70,
        // Triples
        '0,0,0':2.90,
        '1,0,0':3.30, '0,1,0':3.30, '0,0,1':3.20,
        '1,1,0':3.80, '1,0,1':3.75, '0,1,1':3.75,
        '1,1,1':4.425,
        '2,0,0':3.50, '0,2,0':3.50, '0,0,2':3.40,
        '2,1,0':4.00, '1,2,0':4.00, '0,2,1':4.00, '0,1,2':3.90, '1,0,2':3.90, '2,0,1':3.95,
        '2,1,1':4.20, '1,2,1':4.20, '1,1,2':4.10,
        '2,2,0':4.50, '0,2,2':4.50, '2,0,2':4.45,
        '2,2,1':4.80, '2,1,2':4.75, '1,2,2':4.75,
        '2,2,2':5.10,
        '3,1,1':4.60, '1,3,1':4.60, '1,1,3':4.50,
        // Quads — lays and single-fulls
        '0,0,0,0':3.50,
        '1,0,0,0':3.90, '0,1,0,0':3.90, '0,0,1,0':3.90, '0,0,0,1':3.80,
        '1,1,0,0':4.40, '1,0,1,0':4.35, '1,0,0,1':4.30,
        '0,1,1,0':4.40, '0,1,0,1':4.35, '0,0,1,1':4.30,
        '1,1,1,0':5.00, '1,1,0,1':4.95, '1,0,1,1':4.95, '0,1,1,1':4.95,
        '1,1,1,1':5.80,
        // Quads — one double-full
        '2,0,0,0':4.10, '0,2,0,0':4.10, '0,0,2,0':4.00, '0,0,0,2':4.00,
        // Quads — double-full + one single-full
        '2,1,0,0':4.60, '1,2,0,0':4.60,
        '2,0,1,0':4.55, '0,2,1,0':4.55,
        '2,0,0,1':4.50, '0,2,0,1':4.50,
        '1,0,2,0':4.50, '0,1,2,0':4.50,
        '1,0,0,2':4.45, '0,1,0,2':4.45,
        '0,0,2,1':4.45, '0,0,1,2':4.40,
        // Quads — double-full + two single-fulls
        '2,1,1,0':5.10, '1,2,1,0':5.10, '1,1,2,0':5.10,
        '2,1,0,1':5.05, '1,2,0,1':5.00,
        '2,0,1,1':5.00, '0,2,1,1':5.00,
        '0,1,2,1':5.00, '1,0,2,1':5.00,
        '1,1,0,2':4.95, '1,0,1,2':4.95, '0,1,1,2':4.95,
        // Quads — double-full + three single-fulls
        '2,1,1,1':5.95, '1,2,1,1':5.90, '1,1,2,1':5.90, '1,1,1,2':5.85,
        // Quads — two double-fulls
        '2,2,0,0':5.10, '2,0,2,0':5.05, '2,0,0,2':5.00,
        '0,2,2,0':5.10, '0,2,0,2':5.00, '0,0,2,2':4.95,
        // Quads — two double-fulls + one single-full
        '2,2,1,0':5.60, '2,2,0,1':5.55,
        '2,1,2,0':5.55, '2,0,2,1':5.50,
        '2,1,0,2':5.45, '2,0,1,2':5.45,
        '1,2,2,0':5.55, '0,2,2,1':5.50,
        '1,2,0,2':5.45, '0,2,1,2':5.45,
        '1,0,2,2':5.45, '0,1,2,2':5.45,
        // Quads — two double-fulls + two single-fulls
        '2,2,1,1':6.10, '2,1,2,1':6.05, '2,1,1,2':6.00,
        '1,2,2,1':6.05, '1,2,1,2':6.00, '1,1,2,2':5.95,
        // Quads — three double-fulls
        '2,2,2,0':5.70, '2,2,0,2':5.65, '2,0,2,2':5.65, '0,2,2,2':5.65,
        // Quads — three double-fulls + one single-full
        '2,2,2,1':6.40, '2,2,1,2':6.35, '2,1,2,2':6.30, '1,2,2,2':6.30,
        // Quads — four double-fulls
        '2,2,2,2':6.80,
        // Quads — one triple-full
        '3,0,0,0':4.30, '0,3,0,0':4.30, '0,0,3,0':4.20, '0,0,0,3':4.15,
        // Quads — triple-full + one single-full
        '3,1,0,0':4.85, '1,3,0,0':4.85,
        '3,0,1,0':4.80, '0,3,1,0':4.80,
        '3,0,0,1':4.75, '0,3,0,1':4.75,
        '1,0,3,0':4.75, '0,1,3,0':4.75,
        '0,0,3,1':4.65, '1,0,0,3':4.65, '0,1,0,3':4.60, '0,0,1,3':4.55,
        // Quads — triple-full + two single-fulls
        '3,1,1,0':5.50, '3,1,0,1':5.40, '3,0,1,1':5.35,
        '1,3,1,0':5.50, '1,3,0,1':5.40, '0,3,1,1':5.35,
        '1,1,3,0':5.45, '1,0,3,1':5.35, '0,1,3,1':5.40,
        '1,1,0,3':5.25, '1,0,1,3':5.25, '0,1,1,3':5.25,
        // Quads — triple-full + three single-fulls
        '3,1,1,1':6.30, '1,3,1,1':6.25, '1,1,3,1':6.20, '1,1,1,3':6.10,
    };
    const HS_KEY = `hs_${_worldParam}`;
    let highScore = parseFloat(localStorage.getItem(HS_KEY) || '0');

    // ── Competition mode ──────────────────────────────────────────────────────
    const COMP_POOLS = {
        // Singles — only one flip, no ordering issue
        single_easy:   ['0','1'],
        single_medium: ['1','2'],
        single_hard:   ['0','1','2','3'],
        // Doubles — lays (0s) always come first
        double_easy:   ['0,1','1,1'],
        double_medium: ['1,2','2,1'],
        double_hard:   ['1,2','2,1','2,2','2,3'],
        // Triples — lays always precede spins
        triple_easy:   ['0,0,1','0,1,1','1,1,1'],
        triple_medium: ['1,1,1','1,2,1','2,1,1','1,1,2'],
        triple_hard:   ['1,2,1','2,1,2','1,3,1','2,2,2','1,3,2'],
        // Quads — lays always precede spins
        quad_easy:     ['0,0,1,1','0,1,1,1','1,1,1,1'],
        quad_medium:   ['1,1,1,1','0,1,2,1','1,2,1,1','2,1,1,2'],
        quad_hard:     ['1,2,1,1','2,2,1,1','2,2,2,2','2,1,3,1','2,2,3,2'],
        // Hardest — maximum difficulty per jump type
        single_hardest: ['t,t','t,1'],
        double_hardest: ['3,3','1,t,t'],
        triple_hardest: ['2,2,3','3,2,3'],
        quad_hardest:   ['2,3,2,3','2,t,1,2'],
        // Quint — five flips
        quint_easy:     ['0,0,0,1,1','0,0,1,1,1'],
        quint_medium:   ['1,1,1,1,1','2,1,1,1,1','2,2,1,1,1'],
        quint_hard:     ['2,1,2,1,1','1,2,2,2,1'],
        quint_hardest:  ['2,2,2,2,2','2,3,3,2,2'],
    };
    // Ultra — one trick per jump type, each on its matching world
    const ULTRA_POOL   = ['3','2,3','2,2,2','1,3,2','2,2,3,2'];
    const ULTRA_WORLDS = ULTRA_POOL.map(k => ['single','double','triple','quad'][k.split(',').length - 1]);
    const TWIST_NAMES_COMP = ['Lay', 'Full', 'Double Full', 'Triple Full'];
    function trickKeyToName(key) {
        return key.split(',').map(n => n === 't' ? 'Tuck' : TWIST_NAMES_COMP[+n]).join('-');
    }
    // Match a landed trick against an assigned trick key.
    // 't' tokens require 0 twists AND the flip was tucked.
    // '0'-'3' tokens require matching twist count; for '0' in non-hardest pools
    //   tuck is not required (preserves existing easy/medium/hard behaviour).
    function matchTrick(perFlipTwists, tuckedPerFlip, key) {
        const parts = key.split(',');
        if (parts.length !== perFlipTwists.length) return false;
        return parts.every((p, i) => {
            if (p === 't') return perFlipTwists[i] === 0 && tuckedPerFlip[i];
            return perFlipTwists[i] === parseInt(p);
        });
    }
    function compHudLabel(trick) {
        if (_compParam === 'ultra') return `☠ Jump ${_ultraJump + 1}/${ULTRA_POOL.length}: ${trickKeyToName(trick)}`;
        const total = _compProgression.length;
        const current = Math.min(compTricksLanded, total - 1) + 1;
        return `🏆 Trick ${current}/${total}: ${trickKeyToName(trick)}`;
    }
    // Progression uses the pool for the selected difficulty exactly as defined — no resorting.
    // easy uses only the easy pool, medium only medium, hard only hard.
    // Ultra returns only the single trick for the current ultrajump index.
    function buildCompProgression(worldParam, difficulty) {
        if (difficulty === 'ultra') return [ULTRA_POOL[_ultraJump]];
        return [...(COMP_POOLS[`${worldParam}_${difficulty}`] || [])];
    }
    const _compProgression = _compParam ? buildCompProgression(_worldParam, _compParam) : [];
    let compTricksLanded = 0;
    function pickNextCompTrick() {
        if (!_compProgression.length) return null;
        return _compProgression[Math.min(compTricksLanded, _compProgression.length - 1)];
    }
    let assignedTrick    = null; // revealed at takeoff
    let compPendingTrick = _compProgression.length ? pickNextCompTrick() : null; // queued until next jump
    let compLandingResult = null; // { matched: bool, neededKey: string|null }
    let compJustBeaten    = false; // true after final trick landed, until stop
    const compHUDEl = document.getElementById('compHUD');
    if (_compParam) {
        const _initHudTrick = _compParam === 'ultra'
            ? `☠ Jump ${_ultraJump + 1}/${ULTRA_POOL.length}: ${trickKeyToName(ULTRA_POOL[_ultraJump])}`
            : (compPendingTrick ? `🏆 Trick 1/${_compProgression.length}: ${trickKeyToName(compPendingTrick)}` : '🏆');
        compHUDEl.textContent = _initHudTrick;
        compHUDEl.style.display = 'block';
    }
    // ── Olympics mode state ───────────────────────────────────────────────
    let olympicsAttempts  = _olympicsMode ? parseInt(localStorage.getItem('olympics_attempts') || '0', 10) : 0;
    let olympicsBestScore = _olympicsMode ? parseFloat(localStorage.getItem('olympics_best_qual') || '0') : 0;
    let olympicsBestTrick = _olympicsMode ? (localStorage.getItem('olympics_qual_trick') || '–') : '–';
    let olympicsDone      = false; // true after all attempts used in this session
    if (_olympicsMode) {
        compHUDEl.style.display = 'block';
        if (_olympicsMode === 'qual') {
            compHUDEl.style.borderColor = '#aa8800';
            compHUDEl.style.color = '#ffd700';
            compHUDEl.textContent = `🏅 Qualifier — Attempt ${olympicsAttempts + 1} of 2`;
        } else {
            compHUDEl.style.borderColor = '#aa8800';
            compHUDEl.style.color = '#ffd700';
            compHUDEl.textContent = '🏅 Finals — Your Run!';
        }
    }
    // ── Olympics attempt handler ──────────────────────────────────────────
    function _handleOlympicsAttempt(score, trick) {
        if (_olympicsMode === 'finals') {
            olympicsDone = true;
            compHUDEl.textContent = score > 0 ? `🏅 Finals done — ${score.toFixed(1)} pts` : '🏅 Finals — Crash (0 pts)';
            setTimeout(function() {
                if (typeof window._olympicsFinalsDone === 'function') window._olympicsFinalsDone(score, trick);
            }, 1400);
            return;
        }
        // Qualifier
        olympicsAttempts++;
        if (score > olympicsBestScore) { olympicsBestScore = score; olympicsBestTrick = trick; }
        localStorage.setItem('olympics_attempts', String(olympicsAttempts));
        localStorage.setItem('olympics_best_qual', String(olympicsBestScore));
        localStorage.setItem('olympics_qual_trick', olympicsBestTrick);
        if (olympicsAttempts >= 2) {
            olympicsDone = true;
            compHUDEl.textContent = `🏅 Qualifier done — Best: ${olympicsBestScore > 0 ? olympicsBestScore.toFixed(1) + ' pts' : 'no score'}`;
            setTimeout(function() {
                if (typeof window._olympicsQualDone === 'function') window._olympicsQualDone(olympicsBestScore, olympicsBestTrick);
            }, 1400);
        } else {
            compHUDEl.textContent = score > 0
                ? `🏅 Attempt 1 — ${score.toFixed(1)} pts · Press R for attempt 2`
                : '🏅 Attempt 1 — Crash · Press R for attempt 2';
        }
    }
    function calcDD(perFlipTwists) {
        const key = perFlipTwists.join(',');
        if (DD_TABLE[key] !== undefined) return DD_TABLE[key];
        // Fallback for unlisted combos
        const flips = perFlipTwists.length;
        const twists = perFlipTwists.reduce((a, b) => a + b, 0);
        return Math.round((1.4 + flips * 0.5 + twists * 0.4) * 1000) / 1000;
    }

    // ── Billboard (shown when skier stops on outrun) ─────────────────────────
    const bbUI = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('bbUI', true, scene);
    const bbContainer = new BABYLON.GUI.Rectangle('bbContainer');
    bbContainer.width           = '400px';
    bbContainer.height          = '200px';
    bbContainer.cornerRadius    = 14;
    bbContainer.color           = 'rgba(0,0,0,0)';
    bbContainer.background      = 'rgba(0,0,0,0.6)';
    bbContainer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
    bbContainer.verticalAlignment   = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    bbContainer.paddingRight    = '24px';
    bbContainer.isVisible       = false;
    bbUI.addControl(bbContainer);
    const bbStack = new BABYLON.GUI.StackPanel('bbStack');
    bbStack.isVertical = true;
    bbStack.width = '100%';
    bbContainer.addControl(bbStack);
    const bbName = new BABYLON.GUI.TextBlock('bbName');
    bbName.color        = '#ffffff';
    bbName.fontSize     = 30;
    bbName.fontFamily   = 'sans-serif';
    bbName.fontStyle    = 'bold';
    bbName.height       = '90px';
    bbName.textWrapping = BABYLON.GUI.TextWrapping.WordWrap;
    bbName.resizeToFit  = false;
    bbName.outlineWidth = 4;
    bbName.outlineColor = '#000000';
    bbStack.addControl(bbName);
    const bbSub = new BABYLON.GUI.TextBlock('bbSub');
    bbSub.color      = '#aaccff';
    bbSub.fontSize   = 21;
    bbSub.fontFamily = 'sans-serif';
    bbSub.height     = '50px';
    bbSub.outlineWidth = 3;
    bbSub.outlineColor = '#000000';
    bbStack.addControl(bbSub);
    const bbScore = new BABYLON.GUI.TextBlock('bbScore');
    bbScore.color      = '#ffee88';
    bbScore.fontSize   = 21;
    bbScore.fontFamily = 'sans-serif';
    bbScore.fontStyle  = 'bold';
    bbScore.height     = '46px';
    bbScore.outlineWidth = 3;
    bbScore.outlineColor = '#000000';
    bbStack.addControl(bbScore);
    const bbComp = new BABYLON.GUI.TextBlock('bbComp');
    bbComp.color       = '#00ff88';
    bbComp.fontSize    = 21;
    bbComp.fontFamily  = 'sans-serif';
    bbComp.fontStyle   = 'bold';
    bbComp.height      = '40px';
    bbComp.outlineWidth = 3;
    bbComp.outlineColor = '#000000';
    bbComp.isVisible   = false;
    bbStack.addControl(bbComp);
    // Grow container when comp row is visible
    const billboard = {
        get isVisible() { return bbContainer.isVisible; },
        set isVisible(v) {
            bbContainer.isVisible = v;
            bbContainer.height = (v && bbComp.isVisible) ? '240px' : '200px';
        }
    };
    const { hud, hint } = buildHUD(scene);
    const TUCK_RATE = 3.0;

    // ── Flip-power meter ──────────────────────────────────────────────────────
    // Show while on approach; hold ↓ to fill, release to stop filling.
    // At takeoff, L_flip is scaled by the meter value (0.3 → 1.0 of max).
    const pmEl    = document.getElementById('powerMeter');
    const pmFill  = document.getElementById('powerMeterFill');
    const pmTicks = document.getElementById('powerMeterTicks');
    let   flipPower = 0;          // 0.0 – 1.0
    let   pmActive  = false;      // true while meter is visible / accepting input
    let   pmDownHeld = false;     // true while ↓ is held on approach
    const APPROACH_START_Z = SLOPE_START_Z; // show meter from the top of the slope
    const FLIP_POWER_RATE  = 1.7;           // seconds to fill from 0 → 1

    // Build flip-count tick marks.
    // powerScale = 0.3 + flipPower * 0.7; at powerScale=1 the world's nominal
    // flip count is achieved. Place a dash + label for each whole flip number.
    (function buildTicks() {
        // Ticks at 25/50/75/100% — evenly representing 1/2/3/4 flips
        for (let n = 1; n <= 4; n++) {
            const pct = (n / 4 * 100).toFixed(2);
            const tick = document.createElement('div');
            tick.className = 'pmTick';
            tick.style.left = pct + '%';
            pmTicks.appendChild(tick);
        }
    })();

    window.addEventListener('keydown', e => {
        if (e.code === 'ArrowDown' && state.grounded && !state.crashed) pmDownHeld = true;
    });
    window.addEventListener('keyup', e => {
        if (e.code === 'ArrowDown') pmDownHeld = false;
    });

    // ── Physics / render loop ─────────────────────────────────────────────────
    // Tuck transitions over 1/TUCK_RATE seconds (0.17 s)
    scene.registerBeforeRender(() => {
        const dt = engine.getDeltaTime() / 1000; // seconds
        if (paused || dt <= 0 || dt > 0.1) return; // skip when paused / stalled

        // ── Replay playback ────────────────────────────────────────────────
        if (replayActive) {
            const replaySpeedEl = document.getElementById('replaySpeed');
            const speed = replaySpeedEl ? parseFloat(replaySpeedEl.value) : 1.0;
            replayAccum += speed;
            while (replayAccum >= 1) {
                replayAccum -= 1;
                replayIndex++;
                if (replayIndex >= replayFrames.length) {
                    replayActive = false;
                    const rsw = document.getElementById('replaySpeedWrap');
                    if (rsw) rsw.classList.remove('visible');
                    break;
                }
            }
            if (!replayActive) return;
            const f = replayFrames[Math.min(replayIndex, replayFrames.length - 1)];
            character.root.position.y = f.rootY;
            character.root.position.z = f.posZ;
            applyPose(character.meshes, f.tuckAmount, f.armDropL, f.armDropR, f.armSnap, f.layArmT, f.armRaise, f.grounded);
            const qFaceR = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, Math.PI);
            if (f.grounded) {
                character.root.rotationQuaternion = qFaceR;
            } else {
                const qFlipR = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, f.flipAngle);
                const qSpinR = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, f.spinAngle);
                character.root.rotationQuaternion = qFaceR.multiply(qFlipR).multiply(qSpinR);
            }
            camera.target.y = f.rootY;
            camera.target.z = f.posZ;
            return;
        }

        // ── Smooth tuck transition ─────────────────────────────────────────
        if (!state.crashed) {
        const diff = state.tuckTarget - state.tuckAmount;
        const step = TUCK_RATE * dt;
        state.tuckAmount += (Math.abs(diff) <= step) ? diff : Math.sign(diff) * step;
        }

        // ── Terrain physics (frictionless) ────────────────────────────────
        // ── Power meter visibility ──────────────────────────────────────────
        const onApproach = state.grounded && state.posZ >= APPROACH_START_Z && state.posZ < KICKER_END_Z;
        if (onApproach && !pmActive) {
            pmActive = true;
            pmEl.style.display = 'block';
        } else if (!onApproach && pmActive) {
            pmActive = false;
            pmEl.style.display = 'none';
        }
        if (pmActive && pmDownHeld && !readyState) {
            flipPower = Math.min(1, flipPower + dt / FLIP_POWER_RATE);
            pmFill.style.width = (flipPower * 100).toFixed(1) + '%';
        }
        // ── Arm hold timers (count how long each single arm has been up on inrun) ──
        if (state.grounded) {
            if (rightDown && !leftDown) leftArmHoldTime  += dt; else leftArmHoldTime  = 0;
            if (leftDown && !rightDown) rightArmHoldTime += dt; else rightArmHoldTime = 0;
        }
        if (state.grounded) {
            // ── Ready state: freeze at top until ↑ pressed ──────────────────
            if (readyState) {
                if (readyTurnT > 0) {
                    // Advancing turn animation
                    readyTurnT = Math.min(1.0, readyTurnT + dt / READY_TURN_DUR);
                    if (readyTurnT >= 1.0) {
                        readyState  = false;
                        readyTurnT  = 1.0;
                        startRecording();
                    }
                }
                if (readyTurnT < 1.0) {
                    // Still waiting or turning — don't accelerate yet
                    state.vz = 0;
                }
            }
            const prevZ = state.posZ;
            state.vz   += terrainAccelZ(state.posZ) * dt;
            if (state.posZ > OUTRUN_Z && state.vz < 0) {
                state.vz = 0;
                if (!state.stopped && !state.crashed && state.trickName) {
                    state.stopped = true;
                    stopRecording();
                    const totalFlips  = state.perFlipTwists.length;
                    const totalTwists = state.perFlipTwists.reduce((a, b) => a + b, 0);
                    const dd    = calcDD(state.perFlipTwists);
                    const score = Math.round(dd * state.execution * 10) / 10;
                    const isNew = score > highScore;
                    if (isNew) { highScore = score; localStorage.setItem(HS_KEY, score); }
                    bbName.text  = state.trickName;
                    bbSub.text   = _compParam ? '' : `${totalFlips} flip${totalFlips !== 1 ? 's' : ''} · ${totalTwists} twist${totalTwists !== 1 ? 's' : ''}  ·  DD ${dd}  ×  exec ${state.execution}`;
                    bbScore.text = _compParam ? '' : (isNew ? `★ NEW BEST  ${score}` : `${score}  (best: ${highScore})`);
                    bbSub.isVisible   = !_compParam;
                    bbScore.isVisible = !_compParam;
                    if (compLandingResult !== null) {
                        bbComp.text      = compLandingResult.matched ? '✓ Trick Complete!' : `✗ Needed: ${trickKeyToName(compLandingResult.neededKey)}`;
                        bbComp.color     = compLandingResult.matched ? '#00ff88' : '#ff6644';
                        bbComp.isVisible = true;
                    }
                    billboard.isVisible = true;
                    if (_compParam && !compJustBeaten) {
                        const _msg = (compLandingResult && !compLandingResult.matched) ? 'Press R to restart...' : 'Press R to continue...';
                        compHUDEl.textContent = (_compParam === 'ultra' ? '☠ ' : '🏆 ') + _msg;
                    }
                    if (compJustBeaten) {
                        compJustBeaten = false;
                        const isLastUltraJump = _compParam === 'ultra' && _ultraJump === ULTRA_POOL.length - 1;
                        if (_compParam !== 'ultra' || isLastUltraJump) {
                            if (typeof window.showCongratsScreen === 'function') window.showCongratsScreen(_compParam === 'ultra' ? 'quad' : _worldParam, _compParam);
                        } else {
                            compHUDEl.textContent = '☠ Press R for next jump →';
                        }
                    }
                    // ── Olympics attempt tracking (good landing) ─────────
                    if (_olympicsMode && !olympicsDone) {
                        _handleOlympicsAttempt(score, state.trickName);
                    }
                }
            }

            state.posZ += state.vz * dt;
            // Only launch when actually crossing the kicker tip (not after landing past it)
            const crossingJ1 = prevZ <= KICKER_END_Z && state.posZ > KICKER_END_Z;
            if (crossingJ1) {
                state.vy       = state.vz * Math.sin(KICKER_ANGLE);
                state.vz       = state.vz * Math.cos(KICKER_ANGLE);
                state.rootY    = terrainRootY(KICKER_END_Z) + 0.10;
                state.grounded = false;
                // Reset per-flip twist tracking
                state.perFlipTwists   = [];
                state.lastFlipInt     = 0;
                state.spinAtFlipStart = state.spinAngle;
                state.spinBoundaries  = [];
                state.perFlipTucked   = [];
                state.currentFlipTucked = false;
                state.airTime         = 0.0;
                state.armSnap         = 0.0;
                state.layArmT         = 0.0;
                state.armRaise        = 0.0;
                state.armRaiseTarget  = 0;
                state.armSnapTarget   = 0;
                // Hide billboard on takeoff
                billboard.isVisible   = false;
                bbComp.isVisible      = false;
                compLandingResult     = null;
                state.stopped         = false;
                // Reveal the pending trick now that skier is airborne
                if (compPendingTrick !== null) {
                    assignedTrick    = compPendingTrick;
                    compPendingTrick = null;
                    compHUDEl.textContent = compHudLabel(assignedTrick);
                }
                // Apply flip power: 3rd dash (75%) = world-normal flip speed
                if (crossingJ1) {
                    state.L_flip = I0 * TARGET_OMEGA_UNTUCKED * (Math.max(0.05, flipPower) / 0.75);
                    // Reset meter for next jump
                    flipPower = 0;
                    pmFill.style.width = '0%';
                }
                    // Arm up at takeoff → 2 fast twists toward that side (only if held long enough)
                if (rightDown && !leftDown && leftArmHoldTime >= ARM_HOLD_REQ) {
                    state.spinTarget = state.spinAngle + Math.PI * 4;
                    armSwapPhase = true;
                    armSwapDir   = 1;
                    autoSpinActive = false;
                } else if (leftDown && !rightDown && rightArmHoldTime >= ARM_HOLD_REQ) {
                    state.spinTarget = state.spinAngle - Math.PI * 4;
                    armSwapPhase = true;
                    armSwapDir   = -1;
                    autoSpinActive = false;
                }
            } else {
                state.rootY = terrainRootY(state.posZ) + 0.10;
                // When upright (readyState, tilt=0) the full FOOT_OFFSET goes straight
                // down so the skis sit on the surface. As tilt increases, compensate so
                // the foot doesn't sink: rootY lifts by FOOT_OFFSET*(1-cos(tilt)).
                if (readyState && readyTurnT < 1.0) {
                    const rawTilt = -SLOPE_ANGLE; // slope angle at start position
                    const blendedTilt = rawTilt * readyTurnT;
                    state.rootY += FOOT_OFFSET * (1.0 - Math.cos(blendedTilt));
                }
                // Inrun crouch: sink root down so body comes toward skis
                state.rootY -= state.tuckAmount * 0.35;
            }
        } else {
            state.vy    -= GRAVITY * dt;
            state.rootY += state.vy * dt;
            state.posZ  += state.vz * dt;
            // Track air time and tuck time for execution scoring
            state.airTime    += dt;

            const surY   = terrainRootY(state.posZ);
            if (state.rootY <= surY) {
                const TWO_PI  = Math.PI * 2;
                const norm    = ((state.flipAngle % TWO_PI) + TWO_PI) % TWO_PI;
                const LAND_TOL = Math.PI / 4; // 45° — clean landing window
                const spinNorm = ((state.spinAngle % TWO_PI) + TWO_PI) % TWO_PI;
                const SPIN_TOL = Math.PI / 4; // 45° — must be facing forward
                const facingForward = spinNorm < SPIN_TOL || spinNorm > TWO_PI - SPIN_TOL;
                const autoLand = localStorage.getItem('setting_autoland') === '1';
                const goodLanding = autoLand || ((norm < LAND_TOL || norm > TWO_PI - LAND_TOL) && facingForward);

                state.rootY      = surY + 0.10;
                state.vy         = 0;
                state.grounded   = true;
                const capturedSpin = state.spinAngle;
                state.spinAngle  = 0;
                state.spinTarget = 0;
                state.tuckTarget = 0;
                state.tuckAmount = 0;
                armSwapPhase   = false;
                autoSpinActive = false;
                state.spinMult  = 1.0; // reset spin multiplier on landing
                powerWrapDown   = false; // clear power wrap on landing

                if (goodLanding) {
                    // Compute per-flip twists from recorded spin boundary values.
                    // spinBoundaries records the spin angle at each completed flip revolution.
                    // If the skier overshoots slightly, the last boundary fires before landing,
                    // and capturedSpin would create a spurious near-zero trailing interval.
                    // Only add capturedSpin when boundaries don't yet cover all completed flips.
                    const completedFlips = Math.round(Math.abs(state.flipAngle) / (Math.PI * 2));
                    const spinPoints = [state.spinAtFlipStart, ...state.spinBoundaries];
                    if (spinPoints.length - 1 < completedFlips) spinPoints.push(capturedSpin);
                    // Capture tuck status for the last (current) flip
                    const lastFlipTucked = state.currentFlipTucked || state.tuckAmount > 0.3;
                    const tuckedPerFlip = [...state.perFlipTucked];
                    if (tuckedPerFlip.length < completedFlips) tuckedPerFlip.push(lastFlipTucked);
                    state.perFlipTwists = [];
                    for (let i = 0; i < spinPoints.length - 1; i++) {
                        state.perFlipTwists.push(Math.round(Math.abs(spinPoints[i + 1] - spinPoints[i]) / (Math.PI * 2)));
                    }
                    // Build trick name
                    const TWIST_NAMES = ['Lay', 'Full', 'Double Full', 'Triple Full'];
                    state.trickName = state.perFlipTwists
                        .map((t, i) => t === 0 && tuckedPerFlip[i] ? 'Tuck' : TWIST_NAMES[Math.min(t, 3)])
                        .join('-');
                    // ── Achievement: Triple Full-Triple Full-Triple Full on triple jump ─
                    if (_worldParam === 'triple' && state.trickName === 'Triple Full-Triple Full-Triple Full') {
                        localStorage.setItem('ach_3f3f3f', '1');
                    }
                    // ── Competition progression ───────────────────────────────
                    if (assignedTrick !== null) {
                        const _matched = matchTrick(state.perFlipTwists, tuckedPerFlip, assignedTrick);
                        compLandingResult = { matched: _matched, neededKey: _matched ? null : assignedTrick };
                        assignedTrick = null; // clear until next takeoff
                        if (_matched && _compProgression.length) {
                            compTricksLanded++;
                            // Check if this was the final trick in the progression
                            if (compTricksLanded >= _compProgression.length) {
                                // For ultra: only save trophy on the last jump
                                const isLastUltraJump = _compParam === 'ultra' && _ultraJump === ULTRA_POOL.length - 1;
                                if (_compParam !== 'ultra' || isLastUltraJump) {
                                    const beatenKey = _compParam === 'ultra' ? 'comp_beaten_quad_ultra' : `comp_beaten_${_worldParam}_${_compParam}`;
                                    const wasNew = localStorage.getItem(beatenKey) !== '1';
                                    localStorage.setItem(beatenKey, '1');
                                    // Check if this completes the entire collection
                                    if (wasNew) {
                                        const allBase = ['single','double','triple','quad'].every(w =>
                                            ['easy','medium','hard','hardest'].every(d => localStorage.getItem(`comp_beaten_${w}_${d}`) === '1')
                                        ) && localStorage.getItem('comp_beaten_quad_ultra') === '1';
                                        const allQuint = ['easy','medium','hard','hardest'].every(d => localStorage.getItem(`comp_beaten_quint_${d}`) === '1');
                                        if (allBase && allQuint) window._justCompletedAll = true;
                                    }
                                }
                                compJustBeaten = true;
                            }
                            compPendingTrick = pickNextCompTrick();
                        } else {
                            // Missed trick — reset to start of progression
                            compTricksLanded = 0;
                            compPendingTrick = pickNextCompTrick();
                        }
                        if (!compJustBeaten) {
                            // HUD updated to 'Press R' when state.stopped fires at outrun
                        }
                    }
                    // ── Execution score ──────────────────────────────────────
                    // Clean landing = 30; crash = 0 (handled in else branch)
                    state.execution = 30;
                    state.crashed   = false;
                    state.flipAngle = 0;
                    state.flipDir   = 1;
                    // preserve vz so skier glides away down the landing slope
                } else {
                    state.crashed = true;
                    state.flipDir = 1;
                    state.vz      = 0; // stop sliding on crash
                    // Crash — reset comp progression, queue new trick for next jump
                    if (assignedTrick !== null) {
                        assignedTrick    = null;
                        compTricksLanded = 0;
                        compPendingTrick = pickNextCompTrick();
                        compHUDEl.textContent = '🏆 Press R to restart...';
                    }
                    // Olympics crash — counts as a 0-score attempt
                    if (_olympicsMode && !olympicsDone) {
                        _handleOlympicsAttempt(0, 'Crash');
                    }
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
            state.flipAngle += omega * state.flipDir * dt;
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
            const powerWrapMult = powerWrapDown ? 1.3 : 1.0;
            // Gradually slow flip while ↑ is held (min 30% of original)
            if (arrowUpDown) {
                const minL = I0 * TARGET_OMEGA_UNTUCKED * 0.75;
                state.L_flip = Math.max(minL, state.L_flip * (1 - 0.4 * dt));
            }
            if (doubleMode) {
                // Continuous spin at 2× speed while both keys held
                state.spinAngle += state.doubleDir * SPIN_SPEED * state.spinMult * powerWrapMult * 2 * dt;
                // Keep spinTarget just ahead so arm-drop logic stays active
                state.spinTarget = state.spinAngle + state.doubleDir * 0.01;
            } else {
                const spinDiff = state.spinTarget - state.spinAngle;
                if (Math.abs(spinDiff) > 0.001) {
                    const spinStep = SPIN_SPEED * state.spinMult * powerWrapMult * (autoSpinActive ? 2 : 1) * dt;
                    state.spinAngle += (Math.abs(spinDiff) <= spinStep)
                        ? spinDiff
                        : Math.sign(spinDiff) * spinStep;
                } else {
                    autoSpinActive = false;
                }
            }
        }

        // ── Per-flip twist boundary detector (after spin update) ────────────────
        if (!state.grounded) {
            if (state.tuckAmount > 0.3) state.currentFlipTucked = true;
            const currentFlipInt = Math.floor(Math.abs(state.flipAngle) / (Math.PI * 2));
            if (currentFlipInt > state.lastFlipInt) {
                state.spinBoundaries.push(state.spinAngle);
                state.perFlipTucked.push(state.currentFlipTucked);
                state.currentFlipTucked = false;
                state.lastFlipInt = currentFlipInt;
            }
        }

        // ── Arm drop: wind-up, active spin, or double mode ─────────────────
        const spinRemaining = state.spinTarget - state.spinAngle;
        // Arm swap phase overrides normal arm targets
        const spinDrivesArm = !state.grounded;
        let armLTarget, armRTarget;
        if (armSwapPhase) {
            armLTarget = armSwapDir ===  1 ? 1.0 : 0.0;
            armRTarget = armSwapDir === -1 ? 1.0 : 0.0;
            // Detect swap completion, then switch to 2x auto-spin
            const swapDone = armSwapDir === 1
                ? (state.armDropL >= 0.99 && state.armDropR <= 0.01)
                : (state.armDropR >= 0.99 && state.armDropL <= 0.01);
            if (swapDone) {
                armSwapPhase   = false;
                autoSpinActive = true;
            }
        } else {
            // Keep arms down on inrun until ~1 second before the flat table
            const timeToTable = state.vz > 0 ? (FLAT_Z - state.posZ) / state.vz : Infinity;
            const onInrun = state.grounded && state.posZ < FLAT_Z && timeToTable > 1.0;
            armLTarget = onInrun || state.crashed || (leftDown && !rightDown) || doubleMode || (spinDrivesArm && spinRemaining >  0.05) ? 1.0 : 0.0;
            armRTarget = onInrun || state.crashed || (rightDown && !leftDown) || doubleMode || (spinDrivesArm && spinRemaining < -0.05) ? 1.0 : 0.0;
        }
        const armStep = ARM_DROP_RATE * dt;
        const dL = armLTarget - state.armDropL;
        const dR = armRTarget - state.armDropR;
        state.armDropL += Math.abs(dL) <= armStep ? dL : Math.sign(dL) * armStep;
        state.armDropR += Math.abs(dR) <= armStep ? dR : Math.sign(dR) * armStep;
        // Animate arm snap (forward 50° position)
        const dSnap = state.armSnapTarget - state.armSnap;
        state.armSnap += Math.abs(dSnap) <= armStep ? dSnap : Math.sign(dSnap) * armStep;
        // Animate arm raise (straight up)
        const dRaise = state.armRaiseTarget - state.armRaise;
        state.armRaise += Math.abs(dRaise) <= armStep ? dRaise : Math.sign(dRaise) * armStep;
        // Fade snap and raise back out on landing
        if (state.grounded) { state.armSnapTarget = 0; state.armRaiseTarget = 0; }

        // ── Lay T-pose: arms drift out to sides when no inputs on first flip ──
        const inFirstFlip = !state.grounded && !state.crashed && Math.abs(state.flipAngle) < Math.PI * 2;
        const noInputs    = !leftDown && !rightDown && state.tuckTarget === 0 && !doubleMode;
        const layTTarget  = inFirstFlip && noInputs ? 1.0 : 0.0;
        const layTStep    = 1.8 * dt; // ~0.55 s to fully extend
        const dLayT       = layTTarget - state.layArmT;
        state.layArmT    += Math.abs(dLayT) <= layTStep ? dLayT : Math.sign(dLayT) * layTStep;

        // ── Apply body pose ────────────────────────────────────────────────
        applyPose(character.meshes, state.tuckAmount, state.armDropL, state.armDropR, state.armSnap, state.layArmT, state.armRaise, state.grounded);

        // ── Character rotation ─────────────────────────────────────────────
        // qFace turns the character to face +Z (downhill direction).
        // In readyState the character starts facing sideways (+π/2) and smoothly
        // rotates to face downhill (0) as readyTurnT goes 0→1.
        const readyYaw = readyState ? (1.0 - readyTurnT) * (Math.PI / 2) : 0.0;
        const qFace = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, Math.PI + readyYaw);
        if (state.grounded) {
            let tilt = 0;
            if (state.posZ >= SLOPE_START_Z && state.posZ < FLAT_Z)           tilt = -SLOPE_ANGLE;
            else if (state.posZ < SLOPE_START_Z)                               tilt = 0;
            else if (state.posZ >= FLAT_Z && state.posZ < KICKER_Z)          tilt = 0;
            else if (state.posZ >= KICKER_Z && state.posZ <= KICKER_END_Z)   tilt = KICKER_ANGLE;
            else if (state.posZ > KICKER_END_Z && state.posZ <= OUTRUN_Z) tilt = -LANDING_ANGLE;
            else if (state.posZ > OUTRUN_Z)                               tilt = 0; // flat outrun
            // During ready-state turn, blend tilt from 0 (upright) to full slope tilt
            if (readyState) tilt = tilt * readyTurnT;
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

        // ── Camera follow ──────────────────────────────────────────────────────────────
        camera.target.y = state.rootY;
        camera.target.z = state.posZ;
        if (cameraFollow) {
            const BASE_BETA = Math.PI / 3.2 - 2 * Math.PI / 180;
            const betaTarget = state.grounded ? BASE_BETA : BASE_BETA - 4 * Math.PI / 180;
            camera.beta += (betaTarget - camera.beta) * Math.min(1, 5 * dt);
        }

        // ── Record frame ───────────────────────────────────────────────────
        if (recordingActive) recordFrame();

        // ── HUD ───────────────────────────────────────────────────────────
        const rotations = state.flipAngle / (2 * Math.PI);
        hud.text = '';
        hint.text = readyState && readyTurnT === 0.0
            ? '↑: Start run\ndrag: orbit'
            : 'SPACE: tuck\n← then →: left twist\n→ then ←: right twist\n↓: power wrap\ndrag: orbit';
    });

    // ── Run ───────────────────────────────────────────────────────────────────
    engine.runRenderLoop(() => scene.render());
});
