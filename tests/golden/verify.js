'use strict';
// ── The refactor gate (ADR-0005) ─────────────────────────────────────────────
// Replays every scenario against the CURRENT code and compares to the stored
// golden traces. Any divergence beyond epsilon is a regression.
//
//   node tests/golden/verify.js           verify all
//   node tests/golden/verify.js aerial    verify a subset
//
// Exit code 0 = all match. Non-zero = at least one divergence.
//
// This is what makes the engine extraction safe: the physics feel is not
// specified anywhere except as the behaviour of the current code, so
// "looks equivalent" is not good enough. This turns it into pass/fail.

const fs   = require('node:fs');
const path = require('node:path');
const { scenarios }   = require('./scenarios');
const { runScenario } = require('./run-scenario');

const DIR = path.join(__dirname, 'traces');

/** Positions/angles are in world units and radians; 1e-6 is the stored precision. */
const EPSILON = 1e-6;

function cmpNum(a, b) {
    if (typeof a !== 'number' || typeof b !== 'number') return a === b;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
    return Math.abs(a - b) <= EPSILON;
}

function diffRec(expected, actual, pathStr, out, limit) {
    if (out.length >= limit) return;
    if (Array.isArray(expected) && Array.isArray(actual)) {
        if (expected.length !== actual.length) {
            out.push(`${pathStr}: length ${expected.length} → ${actual.length}`);
            return;
        }
        for (let i = 0; i < expected.length; i++) {
            if (!cmpNum(expected[i], actual[i])) {
                out.push(`${pathStr}[${i}]: ${expected[i]} → ${actual[i]}`);
                if (out.length >= limit) return;
            }
        }
        return;
    }
    if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
        const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
        for (const k of keys) {
            if (!(k in expected)) { out.push(`${pathStr}.${k}: absent → present`); }
            else if (!(k in actual)) { out.push(`${pathStr}.${k}: present → absent`); }
            else diffRec(expected[k], actual[k], `${pathStr}.${k}`, out, limit);
            if (out.length >= limit) return;
        }
        return;
    }
    if (!cmpNum(expected, actual)) {
        out.push(`${pathStr}: ${JSON.stringify(expected)} → ${JSON.stringify(actual)}`);
    }
}

function verifyOne(sc) {
    const file = path.join(DIR, sc.name + '.json');
    if (!fs.existsSync(file)) {
        return { name: sc.name, status: 'MISSING', detail: 'no stored trace — run capture.js' };
    }
    const expected = JSON.parse(fs.readFileSync(file, 'utf8'));

    let actual;
    try {
        actual = runScenario(sc);
    } catch (e) {
        return { name: sc.name, status: 'BOOT FAIL', detail: String(e && e.message || e) };
    }

    if (JSON.stringify(expected.error) !== JSON.stringify(actual.error)) {
        return {
            name: sc.name, status: 'FAIL',
            detail: `error state changed: ${JSON.stringify(expected.error)} → ${JSON.stringify(actual.error)}`,
        };
    }
    if (expected.frames.length !== actual.frames.length) {
        return {
            name: sc.name, status: 'FAIL',
            detail: `keyframe count ${expected.frames.length} → ${actual.frames.length}`,
        };
    }

    const diffs = [];
    for (let i = 0; i < expected.frames.length && diffs.length < 6; i++) {
        diffRec(expected.frames[i], actual.frames[i], `frame[${expected.frames[i].f}]`, diffs, 6);
    }
    if (diffs.length) return { name: sc.name, status: 'FAIL', detail: diffs.join('\n      ') };
    return { name: sc.name, status: 'PASS', detail: `${expected.frames.length} keyframes` };
}

function main() {
    const filter = process.argv[2];
    const list = filter ? scenarios.filter(s => s.name.includes(filter)) : scenarios;

    let failed = 0;
    for (const sc of list) {
        const r = verifyOne(sc);
        if (r.status !== 'PASS') failed++;
        console.log(`${r.status.padEnd(10)} ${r.name.padEnd(32)} ${r.status === 'PASS' ? r.detail : ''}`);
        if (r.status !== 'PASS') console.log('      ' + r.detail);
    }

    console.log(`\n${list.length - failed}/${list.length} scenarios match the golden traces.`);
    if (failed) {
        console.log('\nA divergence means the refactor changed observable behaviour.');
        console.log('Either the change is a bug, or the feel changed deliberately —');
        console.log('in which case regenerate traces with capture.js as an explicit act.');
        process.exit(1);
    }
}

main();
