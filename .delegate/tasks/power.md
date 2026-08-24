You are extracting game logic from a JavaScript game into a shared engine module. Output ONLY code, no prose, no markdown fences.

## The logic to extract

From `game.js` (around line 3455):

```js
                // Apply flip power: 3rd dash (75%) = world-normal flip speed.
                // Gamepad: minimum 75% so a normal take-off always produces a full flip;
                // holding L2 on approach charges up to 133% for extra speed.
                const _gpMode = _lsGet('setting_gamepad') === '1';
                const _minPwr = _gpMode ? 0.75 : 0.05;
                targetL_flip = I0 * TARGET_OMEGA_UNTUCKED * (Math.max(_minPwr, flipPower) / 0.75);
```

Constants: `CALIBRATION_POWER` is `0.75` (the "3rd dash" that yields exactly world-normal flip speed). `MIN_POWER_KEYBOARD` is `0.05`. `MIN_POWER_GAMEPAD` is `0.75`.

## Why this is being extracted

The existing tests for this formula are TAUTOLOGICAL — they write `Math.max(0.05, 0.75) / 0.75` out as a literal in the test file and assert about their own literal, never calling game.js. Changing the real constant in game.js leaves every one of those tests passing. Extracting the formula makes it directly testable.

## What to produce

### FILE 1 — `engine/core/power.js`

Follow EXACTLY this dual-mode pattern (it must load via `require()` in Node, via `<script>` in a browser, and via `vm.runInContext` in the test harness — the project has no bundler):

```js
(function (global) {
'use strict';

// ... constants and functions here ...

const api = { /* exports */ };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).power = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
```

Export exactly:
- `CALIBRATION_POWER` = 0.75
- `MIN_POWER_KEYBOARD` = 0.05
- `MIN_POWER_GAMEPAD` = 0.75
- `minPower(gamepadMode)` → returns MIN_POWER_GAMEPAD when `gamepadMode` is truthy, else MIN_POWER_KEYBOARD
- `flipSpeedMultiplier(flipPower, gamepadMode)` → returns `Math.max(minPower(gamepadMode), flipPower) / CALIBRATION_POWER`

CRITICAL: the arithmetic must be EXACTLY `Math.max(min, flipPower) / CALIBRATION_POWER` in that order. Do NOT algebraically rearrange. Do NOT clamp the result. Do NOT add validation that changes the value. Floating-point results must be bit-identical to the original expression.

Keep the three explanatory comment lines from the original.

NO `require` of anything. NO BABYLON. NO DOM. NO localStorage — `gamepadMode` is passed IN as a boolean; the module must not read the setting itself.

### FILE 2 — `tests/unit/power.test.js`

Use `const test = require('node:test');` and `const assert = require('node:assert');`
Require via `require('../../engine/core/power.js')`.

Write REAL tests that call the module (not literals):
- `flipSpeedMultiplier(0, false)` is less than 0.1  (unfilled ≈ 6.7%)
- `flipSpeedMultiplier(0.75, false)` equals exactly 1.0  (use assert.strictEqual)
- `flipSpeedMultiplier(1.0, false)` is greater than 1.0
- `flipSpeedMultiplier(0.5, false)` is strictly between `flipSpeedMultiplier(0, false)` and `flipSpeedMultiplier(1.0, false)`
- Monotonicity: over 1000 values of flipPower from 0 to 1, the result never decreases
- Gamepad mode: `flipSpeedMultiplier(0, true)` equals exactly 1.0 (floor is 0.75), and `flipSpeedMultiplier(1.0, true)` is greater than 1.0
- REGRESSION: `minPower(false)` must NOT equal `CALIBRATION_POWER`. This guards the real defect — a past change set the keyboard floor to 0.75, so an unfilled meter always gave 100% speed and the mechanic broke. Assert `minPower(false) < 0.1` with a comment explaining it.

Output format — exactly this, no other text:

===FILE: engine/core/power.js===
<contents>
===FILE: tests/unit/power.test.js===
<contents>
