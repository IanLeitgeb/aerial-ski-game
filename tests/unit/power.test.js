'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
    CALIBRATION_POWER,
    MIN_POWER_KEYBOARD,
    MIN_POWER_GAMEPAD,
    minPower,
    flipSpeedMultiplier,
} = require('../../engine/core/power.js');

test('constants have the calibrated values', () => {
    assert.strictEqual(CALIBRATION_POWER, 0.75);
    assert.strictEqual(MIN_POWER_KEYBOARD, 0.05);
    assert.strictEqual(MIN_POWER_GAMEPAD, 0.75);
});

test('unfilled meter on keyboard gives ~6.7% flip speed', () => {
    const m = flipSpeedMultiplier(0, false);
    assert.ok(m < 0.1, `flipSpeedMultiplier(0, false) was ${m}, expected < 0.1`);
});

test('calibration power (3rd dash) yields exactly world-normal speed', () => {
    assert.strictEqual(flipSpeedMultiplier(0.75, false), 1.0);
});

test('overcharged meter exceeds world-normal speed', () => {
    const m = flipSpeedMultiplier(1.0, false);
    assert.ok(m > 1.0, `flipSpeedMultiplier(1.0, false) was ${m}, expected > 1.0`);
});

test('half power sits strictly between unfilled and full', () => {
    const lo = flipSpeedMultiplier(0, false);
    const mid = flipSpeedMultiplier(0.5, false);
    const hi = flipSpeedMultiplier(1.0, false);
    assert.ok(mid > lo && mid < hi,
        `flipSpeedMultiplier(0.5, false) was ${mid}, expected strictly between ${lo} and ${hi}`);
});

test('monotonic non-decreasing over 1000 values of flipPower from 0 to 1', () => {
    let prev = flipSpeedMultiplier(0 / 999, false);
    for (let i = 1; i <= 999; i++) {
        const fp = i / 999;
        const cur = flipSpeedMultiplier(fp, false);
        assert.ok(cur >= prev,
            `flipPower=${fp} gave ${cur}, which decreased from ${prev} at i=${i}`);
        prev = cur;
    }
});

test('gamepad floor makes an unpowered take-off a full flip', () => {
    assert.strictEqual(flipSpeedMultiplier(0, true), 1.0);
});

test('gamepad overcharge still exceeds world-normal speed', () => {
    const m = flipSpeedMultiplier(1.0, true);
    assert.ok(m > 1.0, `flipSpeedMultiplier(1.0, true) was ${m}, expected > 1.0`);
});

test('REGRESSION: keyboard min power must stay below calibration power', () => {
    // A past change set the keyboard floor to CALIBRATION_POWER (0.75), so an
    // unfilled meter always produced 100% flip speed and the charge mechanic
    // silently stopped mattering. Guard the real defect directly.
    assert.strictEqual(minPower(false), MIN_POWER_KEYBOARD);
    assert.notStrictEqual(minPower(false), CALIBRATION_POWER);
    assert.ok(minPower(false) < 0.1,
        `minPower(false) was ${minPower(false)}, expected < 0.1`);
});
