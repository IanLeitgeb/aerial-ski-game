You are extracting one pure function from a JavaScript game into a standalone CommonJS module. Output ONLY code, no prose, no markdown fences.

Here is the ORIGINAL function, verbatim, from game.js:

```js
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
```

It reads four module-level constants: `SEGMENTS`, `POSE_UNTUCKED`, `POSE_TUCKED`, `BASE_Z`. These ALREADY EXIST, extracted, at `engine/core/body-model.js`, which exports exactly:

```js
module.exports = { SEGMENTS, BASE_Z, POSE_UNTUCKED, POSE_TUCKED };
```

`lerp` ALREADY EXISTS at `engine/core/math.js`, exporting `{ lerp, clamp, normalizeAngle, TWO_PI }`.

TASK: produce the complete contents of ONE file.

FILE — `engine/core/inertia.js`
- `require` lerp from `./math.js` and the four constants from `./body-model.js`.
- Export `computeI` via `module.exports = { computeI };`
- Signature: `computeI(tuck, model)` where `model` is OPTIONAL and defaults to
  the body-model module's exports. When provided it must be an object with
  `{ SEGMENTS, POSE_UNTUCKED, POSE_TUCKED, BASE_Z }` and those must be used
  instead of the defaults. This lets other disciplines supply a different body.
- The arithmetic must be EXACTLY identical, in the SAME ORDER, to the original.
  Do NOT factor out common subexpressions. Do NOT change `y * y` to `y ** 2`.
  Do NOT reorder the two `I +=` statements. Do NOT precompute `seg.h * seg.h`.
  Floating-point addition is not associative — any reordering changes results.
- Keep the explanatory comments.
- NO `BABYLON`, NO `document`, NO `window`, NO `localStorage`. Pure only.

Do NOT write a test file. Tests are handled separately.

Output format — exactly this, no other text:

===FILE: engine/core/inertia.js===
<contents>
