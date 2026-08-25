You are extracting pure math helpers from a JavaScript game into a standalone CommonJS module. Output ONLY code, no prose, no markdown fences.

Here is the ORIGINAL function, verbatim, from game.js:

```js
function lerp(a, b, t) { return a + (b - a) * t; }
```

TASK: produce the complete contents of TWO files.

FILE 1 — `engine/core/math.js`
- Export via `module.exports = { lerp, clamp, normalizeAngle, TWO_PI };`
- `lerp` must be byte-for-byte the same implementation as above. Do NOT rewrite
  it as `a*(1-t) + b*t` — that is a DIFFERENT floating-point expression and
  produces different results. Exact operation order is the requirement.
- `clamp(v, lo, hi)` returns `Math.max(lo, Math.min(hi, v))`.
- `TWO_PI` is `Math.PI * 2`.
- `normalizeAngle(a)` maps any angle into `[0, TWO_PI)` using
  `((a % TWO_PI) + TWO_PI) % TWO_PI` — this exact expression, because the game
  relies on that modulo behaviour for negative angles.
- No require of anything. No BABYLON. No DOM.

FILE 2 — `tests/unit/math.test.js`
- Use `const test = require('node:test');` and `const assert = require('node:assert');`
- Require the module as `require('../../engine/core/math.js')`
- Include a verbatim copy of the original `lerp` renamed `lerpOriginal`.
- DIFFERENTIAL test for lerp: at least 2000 iterations with a deterministic
  seeded PRNG implemented inline (do NOT use Math.random). Random a, b in
  [-1000, 1000] and t in [-0.5, 1.5]. Assert `assert.strictEqual` on every pair.
- Assert these exact identities: lerp(0,10,0)===0, lerp(0,10,1)===10,
  lerp(0,10,0.5)===5.
- For normalizeAngle assert: normalizeAngle(-0.1) is close to TWO_PI-0.1
  (use assert.ok with a 1e-9 tolerance), normalizeAngle(0)===0, and that the
  result is always >= 0 and < TWO_PI across 1000 seeded random inputs in
  [-100, 100].
- For clamp assert: clamp(5,0,1)===1, clamp(-5,0,1)===0, clamp(0.5,0,1)===0.5.

Output format — exactly this, no other text:

===FILE: engine/core/math.js===
<contents>
===FILE: tests/unit/math.test.js===
<contents>
