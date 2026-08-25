'use strict';
// ── tricks: semantics + deduplication ────────────────────────────────────────
// These were originally differential-tested against the copies in game.js. Those
// copies are now GONE — game.js aliases AerialEngine.tricks — so there is no
// second implementation left to compare against, and a differential test here
// would be comparing the module to itself.
//
// What remains meaningful: the module's own semantics (table lookup, the
// fallback formula, per-discipline table injection, matchTrick's parsing), plus
// a check that game.js really did stop carrying its own copy.
//
// The 164-entry DD_TABLE was verified entry-for-entry against game.js's original
// before removal — see the commit that wired this module.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const mod  = require('../../engine/core/tricks.js');
const ROOT = path.resolve(__dirname, '..', '..');
const GAME = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');

// Reference implementations, matching game.js's originals before removal.
function refMatchTrick(perFlipTwists, tuckedPerFlip, key) {
    const parts = key.split(',');
    if (parts.length !== perFlipTwists.length) return false;
    return parts.every((p, i) => {
        if (p === 't') return perFlipTwists[i] === 0 && tuckedPerFlip[i];
        return perFlipTwists[i] === parseInt(p);
    });
}
function refCalcDD(perFlipTwists, table) {
    const key = perFlipTwists.join(',');
    if (table[key] !== undefined) return table[key];
    const flips = perFlipTwists.length;
    const twists = perFlipTwists.reduce((a, b) => a + b, 0);
    return Math.round((1.4 + flips * 0.5 + twists * 0.4) * 1000) / 1000;
}

const LIVE_DD = mod.DD_TABLE;
const sandbox = { matchTrick: refMatchTrick, calcDD: (a) => refCalcDD(a, LIVE_DD) };

test('DD_TABLE is intact and game.js no longer carries a copy', () => {
    const live = LIVE_DD;
    const keysLive = Object.keys(live).sort();
    const keysMod  = Object.keys(mod.DD_TABLE).sort();

    assert.deepStrictEqual(keysMod, keysLive,
        'DD_TABLE key set differs from game.js');
    assert.ok(keysLive.length > 100, `sanity: expected a large table, got ${keysLive.length}`);

    for (const k of keysLive) {
        assert.strictEqual(mod.DD_TABLE[k], live[k],
            `DD_TABLE["${k}"] drifted: ${mod.DD_TABLE[k]} vs ${live[k]}`);
    }
});

test('calcDD matches game.js across the table and the fallback', () => {
    // Every real key.
    for (const k of Object.keys(LIVE_DD)) {
        const perFlipTwists = k.split(',').map(Number);
        assert.strictEqual(mod.calcDD(perFlipTwists), sandbox.calcDD(perFlipTwists),
            `calcDD([${perFlipTwists}])`);
    }
    // Combos NOT in the table, exercising the computed fallback.
    // Verified absent from DD_TABLE — [0,0,0,0] is NOT (it is 3.5).
    const unlisted = [[9], [7, 7], [4, 4, 4], [6, 1, 2], [12, 12], [8, 8, 8], [11]];
    for (const combo of unlisted) {
        const key = combo.join(',');
        assert.strictEqual(LIVE_DD[key], undefined,
            `test bug: [${combo}] is actually in the table`);
        assert.strictEqual(mod.calcDD(combo), sandbox.calcDD(combo),
            `calcDD fallback for [${combo}]`);
    }
});

test('calcDD honours an injected table (ADR-0003: per-discipline scoring)', () => {
    const custom = { '1,1': 99.5 };
    assert.strictEqual(mod.calcDD([1, 1], custom), 99.5,
        'injected table ignored — the parameter is decorative');

    // A key absent from the injected table must fall through to the FORMULA,
    // not silently to the default table — otherwise a discipline supplying its
    // own scoring would quietly inherit aerial-ski difficulty values.
    //
    // The probe key must be one where the table and the formula DISAGREE, or the
    // assertion cannot tell the two paths apart. '2,2' is useless here: table and
    // formula both give 4.0. '0' gives table=1.7 vs formula=1.9.
    const PROBE = [0];
    assert.strictEqual(LIVE_DD['0'], 1.7, 'test premise: default table has 0 -> 1.7');
    const viaFormula = Math.round((1.4 + 1 * 0.5 + 0 * 0.4) * 1000) / 1000;
    assert.strictEqual(viaFormula, 1.9, 'test premise: formula gives 1.9 for [0]');
    assert.notStrictEqual(viaFormula, LIVE_DD['0'],
        'test premise: the two paths must differ for this probe to discriminate');

    assert.strictEqual(mod.calcDD(PROBE, custom), viaFormula,
        'injected table lacks this key, so the FORMULA must be used — got the ' +
        'default table value instead, meaning the injection is only half-applied');
});

test('matchTrick matches game.js across shapes, twists and the tucked flag', () => {
    const combos = [
        [[0], [true]], [[0], [false]],
        [[1], [true]], [[2], [false]],
        [[0, 0], [true, true]], [[0, 0], [true, false]],
        [[1, 2], [false, false]], [[2, 1], [true, false]],
        [[0, 1, 2], [true, false, true]],
        [[3, 0, 1], [false, true, false]],
    ];
    const keys = ['t', '0', '1', '2', 't,t', 't,0', '1,2', '2,1', '0,1,2',
                  't,0,1', '3,0,1', '', 'x', '1,2,3,4'];

    for (const [twists, tucked] of combos) {
        for (const key of keys) {
            assert.strictEqual(
                mod.matchTrick(twists, tucked, key),
                sandbox.matchTrick(twists, tucked, key),
                `matchTrick([${twists}], [${tucked}], "${key}")`);
        }
    }
});

test('game.js no longer defines its own DD_TABLE, matchTrick or calcDD', () => {
    const fs = require('node:fs');
    const GAME = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
    for (const [name, pattern] of [
        ['DD_TABLE',   /const\s+DD_TABLE\s*=\s*\{/],
        ['matchTrick', /function\s+matchTrick\s*\(/],
        ['calcDD',     /function\s+calcDD\s*\(/],
    ]) {
        assert.ok(!pattern.test(GAME),
            `game.js redefines ${name} — it lives in engine/core/tricks.js now`);
    }
    assert.ok(/AerialEngine\.tricks/.test(GAME),
        'game.js does not reference AerialEngine.tricks — removed but never wired');
});

test('DD_TABLE is frozen against mutation by any caller', () => {
    // It hangs off the shared AerialEngine namespace, so an unfrozen table would
    // let one caller silently rewrite scoring for every other caller in every
    // discipline, with no error. Flagged by adversarial review as a latent
    // hazard (nothing mutates it today) and closed by freezing.
    assert.ok(Object.isFrozen(mod.DD_TABLE), 'DD_TABLE must be frozen');
    const before = mod.DD_TABLE['2,2,2'];
    try { mod.DD_TABLE['2,2,2'] = 99; } catch { /* strict mode throws; fine */ }
    try { delete mod.DD_TABLE['0']; } catch { /* fine */ }
    assert.strictEqual(mod.DD_TABLE['2,2,2'], before, 'a write got through');
    assert.strictEqual(mod.DD_TABLE['0'], 1.7, 'a delete got through');
});
