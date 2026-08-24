'use strict';
// ── landing: differential against the original expressions ───────────────────
// This logic is inline inside _startGame rather than a named function, so it can
// neither be called live nor parsed out by name. The reference below is
// transcribed from game.js verbatim.
//
// That is weaker than the live differentials elsewhere and worth stating plainly:
// if the transcription here were wrong in the same way the module is, both would
// agree. Mitigation is that these are five short expressions, and the golden
// traces cover the same code path end-to-end once it is wired.

const test   = require('node:test');
const assert = require('node:assert');
const L      = require('../../engine/core/landing.js');

const TWO_PI = Math.PI * 2;

// ── Reference: verbatim from game.js ────────────────────────────────────────
const REF_LAND_TOL = Math.PI / 4;
const refNorm = (flipAngle) => ((flipAngle % TWO_PI) + TWO_PI) % TWO_PI;

function refFeetDown(flipAngle, LAND_TOL = REF_LAND_TOL) {
    const norm = refNorm(flipAngle);
    return (norm < LAND_TOL || norm > TWO_PI - LAND_TOL);
}

function refExecution(flipAngle, LAND_TOL = REF_LAND_TOL) {
    const norm = refNorm(flipAngle);
    let execRaw;
    if (norm <= LAND_TOL) {
        const fwd = norm / LAND_TOL;
        execRaw = 29 + 1 * fwd;
    } else {
        const bwd = (norm - (TWO_PI - LAND_TOL)) / LAND_TOL;
        execRaw = 25 + 4 * bwd;
    }
    return Math.max(0, Math.round(execRaw * 10) / 10);
}

const refSignedLean = (flipAngle) => {
    const norm = refNorm(flipAngle);
    return norm < Math.PI ? norm : norm - TWO_PI;
};

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('DEFAULT_LAND_TOL is the 45 degree window', () => {
    assert.strictEqual(L.DEFAULT_LAND_TOL, Math.PI / 4);
});

test('isFeetDown matches the original over many rotations', () => {
    const rand = mulberry32(0xFEED);
    for (let i = 0; i < 20000; i++) {
        // Cover many full rotations in both directions — the modulo behaviour on
        // negative angles is exactly where a rewrite goes wrong.
        const a = (rand() - 0.5) * 200;
        assert.strictEqual(L.isFeetDown(a), refFeetDown(a), `isFeetDown(${a})`);
    }
});

test('isFeetDown boundaries are exact', () => {
    const T = REF_LAND_TOL;
    // The original uses STRICT < and >, so the boundary itself is NOT feet-down.
    // An off-by-one to <= would silently widen the landing window.
    assert.strictEqual(L.isFeetDown(T), refFeetDown(T));
    assert.strictEqual(L.isFeetDown(T), false, 'exactly at +tol must not count as feet-down');
    assert.strictEqual(L.isFeetDown(TWO_PI - T), refFeetDown(TWO_PI - T));
    assert.strictEqual(L.isFeetDown(TWO_PI - T), false, 'exactly at -tol must not count');
    assert.strictEqual(L.isFeetDown(0), true, 'upright is feet-down');
    assert.strictEqual(L.isFeetDown(Math.PI), false, 'inverted is not');
});

test('isFeetDown honours a custom tolerance', () => {
    // Discipline-specific tolerance is the reason this is a parameter.
    const wide = Math.PI / 2;
    assert.strictEqual(L.isFeetDown(Math.PI / 3, wide), true,
        'a wider window must accept an angle the default rejects');
    assert.strictEqual(L.isFeetDown(Math.PI / 3), false,
        'test premise: the default window rejects it');
});

test('executionScore matches the original, including rounding', () => {
    const rand = mulberry32(0xBEEF);
    for (let i = 0; i < 20000; i++) {
        const a = (rand() - 0.5) * 200;
        assert.strictEqual(L.executionScore(a), refExecution(a), `executionScore(${a})`);
    }
    // Named anchors from the comments in game.js.
    assert.strictEqual(L.executionScore(0), 29, 'upright scores 29');
    assert.strictEqual(L.executionScore(REF_LAND_TOL), 30, 'max forward lean scores 30');
});

test('signedLean matches the original and flips sign past PI', () => {
    const rand = mulberry32(0xCAFE);
    for (let i = 0; i < 20000; i++) {
        const a = (rand() - 0.5) * 200;
        assert.strictEqual(L.signedLean(a), refSignedLean(a), `signedLean(${a})`);
    }
    assert.strictEqual(L.signedLean(0), 0);
    assert.ok(L.signedLean(Math.PI * 1.5) < 0, 'past PI must read as backward lean');
    assert.ok(L.signedLean(Math.PI * 0.5) > 0, 'before PI must read as forward lean');
});
