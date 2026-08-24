You are replacing five tautological tests with real ones. Output ONLY code, no prose, no markdown fences.

## The problem

`tests/test.html` Section B contains five tests that write the formula out as a literal and assert about their own literal. `game.js` is never called. Changing the real constant in the game leaves all five passing. One of them is literally `assertClose(1.0, 1.0, 1e-9, ...)` — an assertion that cannot fail.

Here is the current Section B, verbatim:

```js
test('Power meter: unfilled gives near-zero flip speed (~6.7%)', () => {
    // INTENDED: not charging the bar = barely any rotation
    const speed = Math.max(0.05, 0) / 0.75;
    assert(speed < 0.1,
        `Unfilled meter should give < 10% flip speed, got ${(speed*100).toFixed(1)}%`);
});
test('Power meter: 3rd dash (75%) gives exactly 100% flip speed', () => {
    // INTENDED: 3rd dash = perfect flip for the hill
    const speed = Math.max(0.05, 0.75) / 0.75;
    assertClose(speed, 1.0, 1e-9,
        `3rd dash (75%) should give exactly 1.0× speed, got ${speed.toFixed(4)}`);
});
test('Power meter: full charge gives more than 100% flip speed', () => {
    // INTENDED: full bar = extra-fast flip beyond the perfect amount
    const speed = Math.max(0.05, 1.0) / 0.75;
    assertGreater(speed, 1.0,
        `Full charge (${speed.toFixed(3)}×) should exceed normal flip speed`);
});
test('Power meter: speed scales linearly above the minimum floor', () => {
    // Speed at 50% charge should be between the minimum and 3rd-dash speed
    const speedHalf = Math.max(0.05, 0.5) / 0.75;
    const speedFull = Math.max(0.05, 1.0) / 0.75;
    assert(speedHalf > 0.05 / 0.75 && speedHalf < speedFull,
        `Half-charge speed (${speedHalf.toFixed(3)}) should be between floor and full`);
});
test('REGRESSION: formula is NOT the clamped version (unfilled ≠ 100%)', () => {
    // Guards against re-introducing the April 2026 "fix" that clamped the floor
    // to 0.75 so unfilled meters always gave 100% speed (breaking the mechanic).
    const speedIfBroken = Math.max(0.75, 0) / 0.75; // the erroneous formula
    const speedCorrect  = Math.max(0.05, 0) / 0.75; // the intended formula
    assertClose(speedIfBroken, 1.0, 1e-9,
        `Sanity: the broken formula gives 1.0 at 0 charge`);
    assert(speedCorrect < 0.1,
        `The correct formula must give < 10% at 0 charge, not ${(speedCorrect*100).toFixed(1)}%`);
});
```

## What is now available

The formula has been extracted into `engine/core/power.js`, which the page loads
BEFORE game.js. In the page it is reachable as the global `AerialEngine.power`,
exporting:

- `CALIBRATION_POWER`      = 0.75
- `MIN_POWER_KEYBOARD`     = 0.05
- `MIN_POWER_GAMEPAD`      = 0.75
- `minPower(gamepadMode)`
- `flipSpeedMultiplier(flipPower, gamepadMode)`

## Your task

Rewrite all five tests so that EVERY assertion calls `AerialEngine.power`.
No literal may restate the formula. If the constants in the module change, these
tests must fail.

Requirements:
- Keep the five test NAMES exactly as they are, so the suite's history is stable.
- Keep the explanatory comments, updating them where they now describe the module.
- Use only the helpers the page provides: `test`, `assert`, `assertClose`,
  `assertGreater`, `assertLess`.
- Add a guard at the top of the FIRST test that throws a clear error if
  `AerialEngine` or `AerialEngine.power` is missing, so a load-order mistake
  reports as that and not as a confusing undefined error.
- The REGRESSION test must guard the real defect: `minPower(false)` must be well
  below `CALIBRATION_POWER`. Assert it by calling the module, and explain in a
  comment that a past change set the keyboard floor to 0.75 so an unfilled meter
  always gave 100% speed and broke the mechanic.
- Never call `.toFixed()` on a value that could be undefined.

Output format — exactly this, no other text. Output ONLY the five replacement
test blocks, one after another, nothing else:

===FILE: .delegate/out/sectionb-block.js===
<the five test(...) blocks>
