You are extracting one pure function from a JavaScript game into a standalone CommonJS module. Output ONLY code, no prose, no markdown fences.

Here is the ORIGINAL function, verbatim, from game.js:

```js
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
```

TASK: produce the complete contents of TWO files.

FILE 1 — `engine/core/pose.js`
- Export `armSweep` via `module.exports = { armSweep };`
- The behaviour must be EXACTLY identical, including floating-point operation
  order. Do NOT "simplify" arithmetic, do NOT reorder operations, do NOT
  precompute constants differently. Bit-identical output is the requirement.
- Keep the explanatory comments.
- No `require` of anything. No BABYLON. No DOM. Pure function only.

FILE 2 — `tests/unit/pose.test.js`
- Use Node's built-in test runner: `const test = require('node:test');`
  and `const assert = require('node:assert');`
- Require the module as `require('../../engine/core/pose.js')`
- Include a VERBATIM COPY of the original function above, renamed
  `armSweepOriginal`, inside the test file.
- Write a DIFFERENTIAL test: loop at least 2000 iterations over a deterministic
  pseudo-random sequence (implement a small seeded PRNG inline — do NOT use
  Math.random, the test must be reproducible). For each iteration pick a random
  `name` from ['upperArmL','upperArmR','lowerArmL','lowerArmR'] and a random `t`
  in [0,1], call both implementations, and assert every returned field
  (x, y, rx, rz, dz) is EXACTLY equal using `assert.strictEqual`.
- Also add explicit edge-case tests for t = 0, t = 0.5, t = 1 for all four names.

Output format — exactly this, no other text:

===FILE: engine/core/pose.js===
<contents>
===FILE: tests/unit/pose.test.js===
<contents>
