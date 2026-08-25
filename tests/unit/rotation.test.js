'use strict';
// Rotation core: shared by aerial ski, trampoline and diving (ADR-0003).
// The discipline-specific caps are CONFIG, so the tests below have to prove the
// config actually drives behaviour rather than being decorative.

const test   = require('node:test');
const assert = require('node:assert');
const { FRONTFLIP_BOOST, angularVelocity, integrateFlip } =
    require('../../engine/core/rotation.js');

const TWO_PI = Math.PI * 2;

test('angularVelocity with no options is exactly L / I', () => {
    // Bit-identical, not approximately: any rearrangement changes results.
    for (const [L, I] of [[10, 3], [0, 1], [123.456, 7.89], [1e-6, 1e6]]) {
        assert.strictEqual(angularVelocity(L, I), L / I, `L=${L} I=${I}`);
        assert.strictEqual(angularVelocity(L, I, {}), L / I, `L=${L} I=${I} (empty opts)`);
    }
});

test('maxOmega caps, and only when it is a number', () => {
    assert.strictEqual(angularVelocity(100, 1, { maxOmega: 13.0 }), 13.0);
    assert.strictEqual(angularVelocity(5, 1, { maxOmega: 13.0 }), 5, 'must not raise a low omega');

    // undefined must mean "no cap" — game.js passes `_trampolineMode ? 13.0 : undefined`,
    // so treating undefined as 0 would freeze every ski jump.
    assert.strictEqual(angularVelocity(100, 1, { maxOmega: undefined }), 100);
    assert.strictEqual(angularVelocity(100, 1, { maxOmega: null }), 100);
});

test('singleLayout cap scales with tuck/pike boost', () => {
    // boost = max(tuck, pike) * 2 ; cap = PI * (1 + boost)
    assert.strictEqual(
        angularVelocity(1e6, 1, { singleLayout: true, tuckAmount: 0, pikeAmount: 0 }),
        Math.PI * 1.0, 'untucked single layout caps at PI (~1 flip)');
    assert.strictEqual(
        angularVelocity(1e6, 1, { singleLayout: true, tuckAmount: 1, pikeAmount: 0 }),
        Math.PI * 3.0, 'full tuck caps at 3x');
    assert.strictEqual(
        angularVelocity(1e6, 1, { singleLayout: true, tuckAmount: 0, pikeAmount: 1 }),
        Math.PI * 3.0, 'full pike caps the same as full tuck');
    // The larger of the two drives it.
    assert.strictEqual(
        angularVelocity(1e6, 1, { singleLayout: true, tuckAmount: 0.2, pikeAmount: 0.9 }),
        Math.PI * (1.0 + 0.9 * 2.0));
    // Absent when the flag is off.
    assert.strictEqual(angularVelocity(1e6, 1, { tuckAmount: 1 }), 1e6);
});

test('caps apply in the original order: maxOmega then singleLayout', () => {
    // Order matters when both are present and the singleLayout cap is lower.
    // Original: omega = L/I; omega = min(omega, 13); omega = min(omega, PI*(1+boost)).
    const got = angularVelocity(1e6, 1, {
        maxOmega: 13.0, singleLayout: true, tuckAmount: 0, pikeAmount: 0,
    });
    assert.strictEqual(got, Math.min(Math.min(1e6 / 1, 13.0), Math.PI * 1.0));
    assert.strictEqual(got, Math.PI, 'lower of the two caps must win');
});

test('integrateFlip matches the original expression bit-for-bit', () => {
    // The original was:
    //   flipDirBoost = (flipDir === -1) ? 1.11 : 1.0
    //   flipAngle += omega * flipDir * flipDirBoost * dt
    // Multiplication is not associative in floating point, so the ORDER of these
    // four factors is part of the contract.
    const dt = 1 / 60;
    for (const flipDir of [1, -1]) {
        for (const omega of [0, 1.234, 7.5, 13.0, 0.0001]) {
            for (const start of [0, -3.3, 12.75]) {
                const boost = (flipDir === -1) ? 1.11 : 1.0;
                const expected = start + omega * flipDir * boost * dt;
                assert.strictEqual(integrateFlip(start, omega, flipDir, dt), expected,
                    `dir=${flipDir} omega=${omega} start=${start}`);
            }
        }
    }
});

test('frontflip boost applies only to flipDir === -1', () => {
    assert.strictEqual(FRONTFLIP_BOOST, 1.11);
    const dt = 1, omega = 1, start = 0;
    const back  = integrateFlip(start, omega, 1, dt);
    const front = integrateFlip(start, omega, -1, dt);
    assert.strictEqual(back, 1, 'backflip gets no boost');
    assert.strictEqual(front, -1.11, 'frontflip is 11% faster, and negative');
    // A boost applied to both directions would be a silent symmetry bug.
    assert.notStrictEqual(Math.abs(back), Math.abs(front));
});

test('clampToFullRotation bounds the result, and only when asked', () => {
    const big = integrateFlip(0, 1000, 1, 1, { clampToFullRotation: true });
    assert.strictEqual(big, TWO_PI);
    const negBig = integrateFlip(0, 1000, -1, 1, { clampToFullRotation: true });
    assert.strictEqual(negBig, -TWO_PI);
    // Off by default: ski mode must be able to rotate past 2pi.
    assert.strictEqual(integrateFlip(0, 1000, 1, 1), 1000);
    assert.strictEqual(integrateFlip(0, 1000, 1, 1, {}), 1000);
});

test('integrateFlip is pure — it mutates nothing', () => {
    const opts = { clampToFullRotation: true };
    const snapshot = JSON.stringify(opts);
    const a = integrateFlip(1.5, 2, 1, 0.5, opts);
    const b = integrateFlip(1.5, 2, 1, 0.5, opts);
    assert.strictEqual(a, b, 'repeated calls must give the same answer');
    assert.strictEqual(JSON.stringify(opts), snapshot, 'opts must not be mutated');
});
