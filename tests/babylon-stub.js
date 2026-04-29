'use strict';
// ── Babylon.js stub for regression tests ──────────────────────────────────
// Load this BEFORE game.js. Provides just enough API surface for game.js to
// initialise without rendering. Exposes test handles on window.BABYLON:
//   BABYLON._engine  — the Engine instance (set in constructor)
//   BABYLON._scene   — the Scene instance  (set in constructor)
//   BABYLON._nodes   — Map<name, node> — every TransformNode and mesh by name
//   BABYLON._lastError — last uncaught error swallowed by render/tick
//   engine._tick(n)  — advance N simulated frames (calls the render loop N times)
//
// The rotationQuaternion property on every node uses a real getter/setter so
// that we can count how many times it is (re-)assigned. This is the mechanism
// that detects the "quaternion mutation" regression: if the setter only fires
// once (at setup) instead of every frame, the test will fail.
(function () {

    // ── Primitives ─────────────────────────────────────────────────────────
    class Vec3 {
        constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
        set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    }
    class Color3 {
        constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; }
    }
    class Color4 {
        constructor(r = 0, g = 0, b = 0, a = 1) { this.r = r; this.g = g; this.b = b; this.a = a; }
    }
    class Vector3 extends Vec3 {
        constructor(x = 0, y = 0, z = 0) { super(x, y, z); }
        static Zero() { return new Vector3(0, 0, 0); }
    }
    class Quaternion {
        constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
        multiply() { return new Quaternion(); }
        static RotationAxis() { return new Quaternion(); }
        static Identity()     { return new Quaternion(0, 0, 0, 1); }
    }

    // ── Node factory ───────────────────────────────────────────────────────
    // Creates an object that looks enough like a Babylon mesh/node for game.js
    // to use it. rotationQuaternion has a counted setter for regression tests.
    function makeNode(name, scene) {
        let _rq = null;
        let _qSetCount = 0;
        const node = {
            name,
            position: new Vec3(),
            rotation: new Vec3(),
            scaling:  new Vec3(1, 1, 1),
            material: null,
            parent:   null,
            isVisible: true,
            _qSetCount: 0,          // exposed for tests
            updateVerticesData() {},
        };
        Object.defineProperty(node, 'rotationQuaternion', {
            get() { return _rq; },
            set(q) { _rq = q; _qSetCount++; node._qSetCount = _qSetCount; },
            configurable: true,
            enumerable: true,
        });
        if (scene && Array.isArray(scene.meshes)) scene.meshes.push(node);
        BABYLON._nodes.set(name, node);
        return node;
    }

    // ── TransformNode ──────────────────────────────────────────────────────
    class TransformNode {
        constructor(name, scene) {
            const n = makeNode(name, null); // TransformNode not added to scene.meshes
            Object.assign(this, n);
            let _rq = null, _qs = 0;
            Object.defineProperty(this, 'rotationQuaternion', {
                get()  { return _rq; },
                set(q) { _rq = q; _qs++; this._qSetCount = _qs; },
                configurable: true, enumerable: true,
            });
            BABYLON._nodes.set(name, this);
        }
    }

    // ── Mesh (also used as 'new BABYLON.Mesh') ─────────────────────────────
    class BabMesh {
        constructor(name, scene) {
            const n = makeNode(name, scene);
            Object.assign(this, n);
            let _rq = null, _qs = 0;
            Object.defineProperty(this, 'rotationQuaternion', {
                get()  { return _rq; },
                set(q) { _rq = q; _qs++; this._qSetCount = _qs; },
                configurable: true, enumerable: true,
            });
        }
        updateVerticesData() {}
    }
    BabMesh.CAP_ALL = 2;

    // ── Materials & Lights ─────────────────────────────────────────────────
    class StandardMaterial {
        constructor() {
            this.diffuseColor   = new Color3();
            this.specularColor  = new Color3();
            this.emissiveColor  = new Color3();
            this.specularPower  = 0;
            this.alpha          = 1;
            this.backFaceCulling = true;
        }
    }
    class HemisphericLight {
        constructor() { this.intensity = 1; this.groundColor = new Color3(); }
    }
    class DirectionalLight {
        constructor(n, d, s) {
            this.intensity = 1;
            this.diffuse   = new Color3(1, 1, 1);
            this.specular  = new Color3(1, 1, 1);
            this.position  = new Vec3();
        }
    }
    class PointLight {
        constructor() {
            this.intensity = 1;
            this.diffuse   = new Color3(1, 1, 1);
            this.range     = 10;
        }
    }

    // ── Camera ─────────────────────────────────────────────────────────────
    class ArcRotateCamera {
        constructor(name, alpha, beta, radius, target, scene) {
            this.alpha = alpha; this.beta = beta;
            this.mode  = 0;    this.fov  = 1;
            this.lowerBetaLimit = 0;    this.upperBetaLimit = Math.PI;
            this.lowerRadiusLimit = 0;  this.upperRadiusLimit = Infinity;
            this.target = new Vec3();
            this.inputs = { removeByType() {} };
        }
        attachControl() {}
    }

    // ── Rendering pipeline ─────────────────────────────────────────────────
    class DefaultRenderingPipeline {
        constructor() {
            this.depthOfFieldEnabled   = false;
            this.depthOfFieldBlurLevel = 0;
            this.depthOfField          = null;
        }
    }

    // ── VertexData ─────────────────────────────────────────────────────────
    class VertexData {
        applyToMesh() {}
        static ComputeNormals(pos, idx, nrm) {
            for (let i = 0; i < nrm.length; i++) nrm[i] = 0;
        }
    }

    // ── MeshBuilder ────────────────────────────────────────────────────────
    const MeshBuilder = {
        _mk(name, scene) { return makeNode(name, scene); },
        CreateBox(n, o, s)        { return this._mk(n, s); },
        CreateSphere(n, o, s)     { return this._mk(n, s); },
        CreateCylinder(n, o, s)   { return this._mk(n, s); },
        CreateTube(n, o, s)       { return this._mk(n, s); },
        CreateLineSystem(n, o, s) { return this._mk(n, s); },
    };

    // ── GUI (minimal stubs) ────────────────────────────────────────────────
    const _guiBase = () => ({
        text: '', color: '', fontSize: 14, fontFamily: '', fontStyle: '',
        fontWeight: '', height: '', width: '', background: '', cornerRadius: 0,
        horizontalAlignment: 0, verticalAlignment: 0, textHorizontalAlignment: 0,
        paddingLeft: '', paddingRight: '', paddingTop: '', paddingBottom: '',
        isVisible: true, resizeToFit: false, textWrapping: false, isVertical: false,
        outlineWidth: 0, outlineColor: '',
        addControl() {},
    });
    const GUI = {
        AdvancedDynamicTexture: { CreateFullscreenUI() { return { addControl() {} }; } },
        TextBlock:  class { constructor() { Object.assign(this, _guiBase()); } },
        Rectangle:  class { constructor() { Object.assign(this, _guiBase()); } },
        StackPanel: class { constructor() { Object.assign(this, _guiBase()); } },
        Control: {
            HORIZONTAL_ALIGNMENT_LEFT: 0, HORIZONTAL_ALIGNMENT_CENTER: 1, HORIZONTAL_ALIGNMENT_RIGHT: 2,
            VERTICAL_ALIGNMENT_TOP:    0, VERTICAL_ALIGNMENT_CENTER:    1, VERTICAL_ALIGNMENT_BOTTOM:  2,
        },
        TextWrapping: { WordWrap: 1 },
    };

    // ── Scene ──────────────────────────────────────────────────────────────
    class Scene {
        constructor() {
            this.clearColor = new Color4();
            this.meshes     = [];
            this._beforeRenderCbs = [];
            BABYLON._scene = this;
        }
        registerBeforeRender(cb) { this._beforeRenderCbs.push(cb); }
        getMeshByName(name) { return BABYLON._nodes.get(name) || null; }
        render() {
            for (const cb of this._beforeRenderCbs) {
                try          { cb(); }
                catch (err)  { BABYLON._lastError = err; }
            }
        }
    }

    // ── Engine ─────────────────────────────────────────────────────────────
    class Engine {
        constructor() {
            this._renderLoop = null;
            BABYLON._engine  = this;
        }
        static isSupported()  { return true; }
        getDeltaTime()         { return 16.667; }  // simulates 60 fps
        runRenderLoop(cb)      { this._renderLoop = cb; }
        getRenderWidth()       { return 800; }
        getRenderHeight()      { return 600; }
        resize()               {}

        // Test helper: advance N simulated frames.
        _tick(n = 1) {
            for (let i = 0; i < n; i++) {
                if (this._renderLoop) {
                    try          { this._renderLoop(); }
                    catch (err)  { BABYLON._lastError = err; }
                }
            }
        }
    }

    // ── Expose ─────────────────────────────────────────────────────────────
    window.BABYLON = {
        // Test handles
        _engine:    null,
        _scene:     null,
        _nodes:     new Map(),
        _lastError: null,

        // Classes
        Engine, Scene, ArcRotateCamera,
        Camera: { ORTHOGRAPHIC_CAMERA: 1, PERSPECTIVE_CAMERA: 0 },
        HemisphericLight, DirectionalLight, PointLight,
        DefaultRenderingPipeline,
        DepthOfFieldEffectBlurLevel: { Medium: 1 },
        TransformNode,
        Mesh: BabMesh,
        MeshBuilder,
        StandardMaterial,
        VertexData,
        VertexBuffer: { PositionKind: 'position', NormalKind: 'normal' },
        Color3, Color4, Vector3, Quaternion,
        Axis: { X: { x:1,y:0,z:0 }, Y: { x:0,y:1,z:0 }, Z: { x:0,y:0,z:1 } },
        GUI,
    };

})();
