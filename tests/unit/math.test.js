'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { lerp, clamp, normalizeAngle, TWO_PI } = require('../../engine/core/math.js');

// Verbatim copy of the original game.js implementation, renamed.
function lerpOriginal(a, b, t) { return a + (b - a) * t; }

// Deterministic seeded PRNG (mulberry32), inline — no Math.random anywhere.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

test('lerp exact identities', () => {
  assert.strictEqual(lerp(0, 10, 0), 0);
  assert.strictEqual(lerp(0, 10, 1), 10);
  assert.strictEqual(lerp(0, 10, 0.5), 5);
});

test('lerp differential vs lerpOriginal over 2000 seeded pairs', () => {
  const rand = mulberry32(0xC0FFEE);
  for (let i = 0; i < 2000; i++) {
    const a = rand() * 2000 - 1000; // [-1000, 1000]
    const b = rand() * 2000 - 1000; // [-1000, 1000]
    const t = rand() * 2 - 0.5;     // [-0.5, 1.5]
    assert.strictEqual(
      lerp(a, b, t),
      lerpOriginal(a, b, t),
      `mismatch at iteration ${i}: a=${a} b=${b} t=${t}`
    );
  }
});

test('normalizeAngle maps angles into [0, TWO_PI)', () => {
  assert.ok(Math.abs(normalizeAngle(-0.1) - (TWO_PI - 0.1)) < 1e-9,
    `normalizeAngle(-0.1) was ${normalizeAngle(-0.1)}, expected close to ${TWO_PI - 0.1}`);
  assert.strictEqual(normalizeAngle(0), 0);

  const rand = mulberry32(1234567);
  for (let i = 0; i < 1000; i++) {
    const a = rand() * 200 - 100; // [-100, 100]
    const r = normalizeAngle(a);
    assert.ok(r >= 0 && r < TWO_PI,
      `normalizeAngle(${a}) returned ${r}, outside [0, TWO_PI)`);
  }
});

test('clamp bounds values correctly', () => {
  assert.strictEqual(clamp(5, 0, 1), 1);
  assert.strictEqual(clamp(-5, 0, 1), 0);
  assert.strictEqual(clamp(0.5, 0, 1), 0.5);
});
