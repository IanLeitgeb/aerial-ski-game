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

test('the running game exposes the wired engine namespaces', () => {
    // Every extracted function is now WIRED, so game.js holds no duplicates to
    // differentially test. What must hold instead is that the game actually
    // loaded the engine and reaches it.
    assert.ok(live.AerialEngine, 'AerialEngine missing — engine modules did not load');
    for (const ns of ['math', 'pose', 'inertia', 'bodyModel']) {
        assert.ok(live.AerialEngine[ns], `AerialEngine.${ns} not registered`);
    }
    // And game.js must NOT still expose its own globals for the wired functions.
    for (const dup of ['lerp', 'armSweep', 'computeI']) {
        assert.strictEqual(typeof live[dup], 'undefined',
            `game.js still exposes a global ${dup} — the duplicate was not removed`);
    }
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

test('armSweep: dual-mode wrapper behaves identically in both realms', () => {
    const mod = require('../../engine/core/pose.js');
    const NAMES = ['upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR'];
    const rand = mulberry32(0xB0A7);
    for (let i = 0; i < 5000; i++) {
        const name = NAMES[Math.floor(rand() * NAMES.length)];
        const t = rand();
        const got = live.AerialEngine.pose.armSweep(name, undefined, t);
        const exp = mod.armSweep(name, undefined, t);
        for (const k of ['x', 'y', 'rx', 'rz', 'dz']) {
            assert.strictEqual(got[k], exp[k], `armSweep(${name}, _, ${t}).${k}`);
        }
    }
    for (const name of NAMES) {
        for (const t of [0, 0.5, 1]) {
            const got = live.AerialEngine.pose.armSweep(name, undefined, t);
            const exp = mod.armSweep(name, undefined, t);
            for (const k of ['x', 'y', 'rx', 'rz', 'dz']) {
                assert.strictEqual(got[k], exp[k], `armSweep(${name}, _, ${t}).${k}`);
            }
        }
    }
});

test('computeI: dual-mode wrapper behaves identically in both realms', () => {
    const mod = require('../../engine/core/inertia.js');
    const rand = mulberry32(0x1234);
    for (let i = 0; i < 5000; i++) {
        const tuck = rand();
        assert.strictEqual(live.AerialEngine.inertia.computeI(tuck), mod.computeI(tuck),
            `dual-mode wrapper diverges: computeI(${tuck})`);
    }
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        assert.strictEqual(live.AerialEngine.inertia.computeI(v), mod.computeI(v),
            `computeI(${v})`);
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

test('body-model: extracted constants match the ones game.js still holds', () => {
    // game.js STILL defines SEGMENTS / BASE_Z / POSE_UNTUCKED / POSE_TUCKED,
    // because buildCharacter and applyPose consume them and are not yet
    // extracted. So a real duplicate exists right now and can drift.
    //
    // This compares the extracted data against those live constants directly —
    // stronger than the previous indirect check via computeI, which became
    // circular once computeI itself came from the module.
    const vm = require('node:vm');
    const bm = require('../../engine/core/body-model.js');
    const read = (name) => vm.runInContext(name, live);

    const liveSegs = read('SEGMENTS');
    assert.strictEqual(bm.SEGMENTS.length, liveSegs.length, 'SEGMENTS length differs');

    for (let i = 0; i < liveSegs.length; i++) {
        const a = bm.SEGMENTS[i], b = liveSegs[i];
        assert.strictEqual(a.name, b.name, `SEGMENTS[${i}].name`);
        for (const k of ['w', 'h', 'd', 'mass']) {
            assert.strictEqual(a[k], b[k], `SEGMENTS[${i}] (${b.name}).${k} drifted`);
        }
        // colour is deliberately absent from the engine copy (renderer data).
        assert.strictEqual(a.color, undefined,
            `SEGMENTS[${i}] carries colour into engine/ — renderer data (ADR-0002)`);
    }

    // Only what game.js STILL holds. The nine POSE_* tables were removed once
    // the pose solver was wired, so there is nothing left to compare for them —
    // that is the point. Their absence is asserted separately below.
    const TABLES = ['BASE_Z'];
    for (const table of TABLES) {
        const liveT = read(table);
        const modT  = bm[table];
        assert.deepStrictEqual(Object.keys(modT).sort(), Object.keys(liveT).sort(),
            `${table} keys differ`);
        for (const key of Object.keys(liveT)) {
            // NOT deepStrictEqual: the live value comes from the vm's realm, so
            // its prototype is that realm's Object.prototype and a strict deep
            // compare fails on prototype identity even when every value matches.
            // Compare own key/value pairs instead.
            const lv = liveT[key], mv = modT[key];
            if (lv !== null && typeof lv === 'object') {
                assert.deepStrictEqual(Object.keys(mv).sort(), Object.keys(lv).sort(),
                    `${table}.${key} field set differs`);
                for (const f of Object.keys(lv)) {
                    assert.strictEqual(mv[f], lv[f],
                        `${table}.${key}.${f} drifted between game.js and ` +
                        `engine/core/body-model.js`);
                }
            } else {
                assert.strictEqual(mv, lv,
                    `${table}.${key} drifted between game.js and engine/core/body-model.js`);
            }
        }
    }
});

test('the pose tables are GONE from game.js, not merely duplicated', () => {
    // Deduplication is the goal, not co-existence. Once computePose was wired,
    // all nine tables became dead code in game.js and were deleted. If one
    // reappears, two sources of truth exist again and can silently diverge.
    const fs   = require('node:fs');
    const path = require('node:path');
    const GAME = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'game.js'), 'utf8');

    const TABLES = [
        'POSE_UNTUCKED', 'POSE_INRUN_TUCK', 'POSE_TUCKED', 'POSE_PIKED',
        'POSE_ARMS_FORWARD', 'POSE_ARMS_DROPPED', 'POSE_ARMS_50DEG',
        'POSE_ARMS_T', 'POSE_ARMS_UP',
    ];
    for (const t of TABLES) {
        const def = new RegExp(`^\\s*const\\s+${t}\\s*=`, 'm');
        assert.ok(!def.test(GAME),
            `game.js redefines ${t} — it lives in engine/core/body-model.js now, ` +
            `and two copies can drift apart`);
    }
    // And the engine must still export every one of them.
    const bm = require('../../engine/core/body-model.js');
    for (const t of TABLES) {
        assert.ok(bm[t], `engine/core/body-model.js no longer exports ${t}`);
    }
});

test('body-model tables are deep-frozen', () => {
    // Same hazard as DD_TABLE: shared via AerialEngine, so a caller mutating a
    // pose table would change the athlete for every discipline. Deep, because
    // the values are nested objects — a shallow freeze would still allow
    // POSE_TUCKED.torso.y = 5.
    const bm = require('../../engine/core/body-model.js');
    for (const name of ['SEGMENTS', 'BASE_Z', 'POSE_UNTUCKED', 'POSE_TUCKED',
                        'POSE_PIKED', 'POSE_ARMS_UP']) {
        assert.ok(Object.isFrozen(bm[name]), `${name} is not frozen`);
    }
    const before = bm.POSE_TUCKED.torso.y;
    try { bm.POSE_TUCKED.torso.y = 999; } catch { /* strict mode throws; fine */ }
    assert.strictEqual(bm.POSE_TUCKED.torso.y, before,
        'nested pose value was mutable — the freeze is shallow, not deep');

    // game.js builds its render SEGMENTS with Object.assign({}, seg, {color}),
    // which copies rather than mutates, so freezing the source cannot break it.
    const derived = bm.SEGMENTS.map(s => Object.assign({}, s, { color: [0, 0, 0] }));
    assert.strictEqual(derived[0].color.length, 3, 'deriving from frozen segments must still work');
    assert.strictEqual(bm.SEGMENTS[0].color, undefined, 'the source must stay colour-free');
});
