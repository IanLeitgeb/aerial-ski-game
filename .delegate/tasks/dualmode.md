You are converting two CommonJS-only modules to dual-mode so they can load in a browser as well as in Node. Output ONLY code, no prose, no markdown fences.

## Why

These modules are currently reachable only from `node --test`. The shipped game cannot load them because they use `require()` and `module.exports`, which do not exist in a browser, and the project has no bundler by design. Until they are dual-mode, the tests around them guard code the game never executes.

## The required pattern

`engine/core/math.js` already uses it. Reproduce it EXACTLY:

```js
(function (global) {
'use strict';

// ... module body ...

const api = { /* exports */ };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).<NAMESPACE> = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
```

For cross-module dependencies inside a browser there is no `require`, so a dual-mode module must resolve its dependencies like this:

```js
const _math = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports)
    ? require('./math.js')
    : global.AerialEngine.math;
```

## File 1 — `engine/core/pose.js`

Current contents:

```js
'use strict';

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

module.exports = { armSweep };
```

Namespace: `pose`. It has no dependencies.

## File 2 — `engine/core/inertia.js`

Current contents:

```js
'use strict';

const { lerp } = require('./math.js');
const bodyModel = require('./body-model.js');

// Moment of inertia about the flip axis (X, shoulder-to-shoulder).
// Distance from X axis = sqrt(y² + z²), so I = Σ [ m_i·(y_i²+z_i²) + m_i·(h_i²+d_i²)/12 ]
function computeI(tuck, model) {
    const { SEGMENTS, POSE_UNTUCKED, POSE_TUCKED, BASE_Z } = model || bodyModel;
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

module.exports = { computeI };
```

Namespace: `inertia`. Dependencies: `math` (for `lerp`) and `bodyModel` (namespace `bodyModel`, exporting `{ SEGMENTS, BASE_Z, POSE_UNTUCKED, POSE_TUCKED }`). Resolve BOTH using the dependency pattern above.

## Hard constraints

- The arithmetic and its ORDER must be byte-for-byte unchanged. Do NOT factor out subexpressions, do NOT change `y * y` to `y ** 2`, do NOT reorder the two `I +=` statements. Floating-point addition is not associative.
- Keep every explanatory comment.
- Preserve the optional `model` parameter on `computeI` and its `model || bodyModel` default.
- No BABYLON, no DOM, no localStorage.

Output format — exactly this, no other text:

===FILE: engine/core/pose.js===
<contents>
===FILE: engine/core/inertia.js===
<contents>
