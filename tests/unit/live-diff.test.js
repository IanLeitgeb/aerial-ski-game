'use strict';
// ── Live differential tests ──────────────────────────────────────────────────
// The strongest equivalence check available, and the one a subagent cannot
// write: instead of comparing an extracted module against a HAND-COPY of the
// original, this boots the real game.js inside the headless harness and calls
// the ACTUAL function, then compares outputs over fuzzed inputs.
//
// Why it matters: a hand-copy comparison passes if the same transcription error
// was made in both copies. This cannot — game.js is the live reference.
//
// Requires the golden-trace harness (tests/golden/harness.js), which boots
// game.js in a vm context where its top-level functions become context globals.

const test   = require('node:test');
const assert = require('node:assert');
const { createSim } = require('../golden/harness');

/** Deterministic PRNG so failures are reproducible. */
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

// One boot shared by every case — booting game.js is the expensive part.
const sim = createSim({ search: '' });
const live = sim.ctx;

test('live game.js exposes the functions still under differential test', () => {
    assert.strictEqual(typeof live.computeI, 'function', 'computeI not reachable');
    assert.strictEqual(typeof live.armSweep, 'function', 'armSweep not reachable');
});

test('lerp: the running game uses the engine module, not a copy of it', () => {
    // lerp is WIRED: game.js reads `const { lerp } = AerialEngine.math`, so there
    // is no second implementation left to differentially test. A fuzz comparison
    // here would be comparing the module against itself and would pass no matter
    // what — worse than useless, because it would look like coverage.
    //
    // The meaningful assertion is now identity: the function the running game
    // holds must be the exact same object the module exports.
    const mod = require('../../engine/core/math.js');

    assert.ok(live.AerialEngine && live.AerialEngine.math,
        'AerialEngine.math is not present in the running game — the engine ' +
        'module did not load before game.js');

    // NOT object identity: require() and the vm evaluate the same file in two
    // different realms, so the two function objects are necessarily distinct.
    // What CAN be asserted is that the one source file behaves identically in
    // both — which is the real risk with a dual-mode (CommonJS + global) wrapper,
    // where one branch could silently diverge from the other.
    const rand = mulberry32(0x1EAF);
    for (let i = 0; i < 5000; i++) {
        const a = (rand() - 0.5) * 2000;
        const b = (rand() - 0.5) * 2000;
        const t = rand() * 2 - 0.5;              // include extrapolation
        assert.strictEqual(live.AerialEngine.math.lerp(a, b, t), mod.lerp(a, b, t),
            `dual-mode wrapper diverges: lerp(${a}, ${b}, ${t})`);
    }

    // And game.js must no longer carry its own global copy.
    assert.strictEqual(typeof live.lerp, 'undefined',
        'game.js still exposes a global lerp — the duplicate was not removed');

    assert.strictEqual(live.AerialEngine.math.lerp(0, 10, 0.5), 5);
});

test('armSweep: extracted module is bit-identical to live game.js', () => {
    const { armSweep } = require('../../engine/core/pose.js');
    const NAMES = ['upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR'];
    const rand = mulberry32(0xB0A7);
    for (let i = 0; i < 5000; i++) {
        const name = NAMES[Math.floor(rand() * NAMES.length)];
        const t = rand();
        const got = armSweep(name, undefined, t);
        const exp = live.armSweep(name, undefined, t);
        for (const k of ['x', 'y', 'rx', 'rz', 'dz']) {
            assert.strictEqual(got[k], exp[k], `armSweep(${name}, _, ${t}).${k}`);
        }
    }
    // Boundaries exactly.
    for (const name of NAMES) {
        for (const t of [0, 0.5, 1]) {
            const got = armSweep(name, undefined, t);
            const exp = live.armSweep(name, undefined, t);
            for (const k of ['x', 'y', 'rx', 'rz', 'dz']) {
                assert.strictEqual(got[k], exp[k], `armSweep(${name}, _, ${t}).${k}`);
            }
        }
    }
});

test('computeI: extracted module is bit-identical to live game.js', (t) => {
    let mod;
    try {
        mod = require('../../engine/core/inertia.js');
    } catch {
        return t.skip('engine/core/inertia.js not extracted yet');
    }
    const rand = mulberry32(0x1234);
    for (let i = 0; i < 5000; i++) {
        const tuck = rand();
        assert.strictEqual(mod.computeI(tuck), live.computeI(tuck), `computeI(${tuck})`);
    }
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        assert.strictEqual(mod.computeI(v), live.computeI(v), `computeI(${v})`);
    }
});

test('computeI: injected-model path matches the default path', () => {
    const { computeI } = require('../../engine/core/inertia.js');
    const bm = require('../../engine/core/body-model.js');

    // The extraction added an optional `model` parameter that the original had
    // no equivalent of (ADR-0003: other disciplines supply a different body).
    // The live differential test only exercises the DEFAULT path, so this is an
    // otherwise-untested branch introduced by the refactor. Passing the default
    // model explicitly must be indistinguishable from omitting it.
    const rand = mulberry32(0x5EED);
    for (let i = 0; i < 2000; i++) {
        const tuck = rand();
        assert.strictEqual(computeI(tuck, bm), computeI(tuck),
            `computeI(${tuck}, defaultModel) must equal computeI(${tuck})`);
    }

    // A genuinely different body must produce a different inertia, otherwise the
    // parameter is silently ignored and the branch is decorative.
    const heavier = {
        ...bm,
        SEGMENTS: bm.SEGMENTS.map(s => ({ ...s, mass: s.mass * 2 })),
    };
    assert.notStrictEqual(computeI(0.5, heavier), computeI(0.5),
        'injected model is being ignored — the parameter does nothing');

    // Explicitly null/undefined must fall back to the default, not throw.
    assert.strictEqual(computeI(0.5, undefined), computeI(0.5));
    assert.strictEqual(computeI(0.5, null), computeI(0.5));
});

test('body-model: extracted constants match live game.js exactly', () => {
    const bm = require('../../engine/core/body-model.js');
    // SEGMENTS is not a context global in every build, so verify indirectly:
    // reproducing computeI from the extracted data must match the live result.
    // Any drift in mass/h/d/pose values changes I and fails here.
    const { lerp } = require('../../engine/core/math.js');
    for (const tuck of [0, 0.3, 0.7, 1]) {
        let I = 0;
        for (const seg of bm.SEGMENTS) {
            const up = bm.POSE_UNTUCKED[seg.name];
            const tk = bm.POSE_TUCKED[seg.name];
            const y  = lerp(up.y,  tk.y,  tuck);
            const dz = lerp(up.dz, tk.dz, tuck);
            const z  = (bm.BASE_Z[seg.name] || 0) + dz;
            I += seg.mass * (y * y + z * z);
            I += seg.mass * (seg.h * seg.h + seg.d * seg.d) / 12;
        }
        I = Math.max(I, 0.5);
        assert.strictEqual(I, live.computeI(tuck),
            `body-model data reproduces computeI(${tuck})`);
    }
});
