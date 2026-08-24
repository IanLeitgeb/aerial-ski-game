'use strict';
// ── Diagnostic scripts must keep working ─────────────────────────────────────
// tests/golden/ holds standalone scripts (reproducers, probes, capture tools)
// that boot game.js outside the normal test path. Nothing in run-all.sh executed
// them, so when game.js gained a parse-time dependency on AerialEngine.math two
// of them silently began throwing ReferenceError — including bug-ragdoll.js,
// which docs/FINDINGS.md instructs readers to run as the BUG-001 reproducer.
//
// This executes each one and asserts it exits cleanly. Behavioural, not
// pattern-matching, so it catches any breakage rather than only this class.

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

// Scripts that boot the game and must exit 0. capture.js is excluded: it
// rewrites the golden traces, which must only ever happen deliberately.
const SCRIPTS = [
    'tests/golden/smoke.js',
    'tests/golden/probe.js',
    'tests/golden/check-math.js',
    'tests/golden/debug-mesh.js',
    'tests/golden/bug-ragdoll.js',
];

// check-distinct.js is excluded from the exit-0 list on purpose: its exit code
// encodes a FINDING, not a failure. It returns 1 whenever any two scenarios
// produce identical skier motion, which is the current OPEN-002 state (27/30
// distinct). It is asserted separately below — it must still RUN.
const REPORTING_SCRIPTS = [
    'tests/golden/check-distinct.js',
];

for (const rel of SCRIPTS) {
    test(`${rel} runs cleanly`, () => {
        let out;
        try {
            out = execFileSync(process.execPath, [rel], {
                cwd: ROOT, encoding: 'utf8', timeout: 120000,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (e) {
            const detail = [e.stdout, e.stderr].filter(Boolean).join('\n').slice(-1200);
            assert.fail(`${rel} exited non-zero:\n${detail}`);
        }
        // A script that boots game.js but silently swallows the boot failure
        // would still exit 0, so check for the signature of that failure.
        assert.ok(!/ReferenceError|is not defined|is not a function/.test(out),
            `${rel} printed an error signature:\n${out.slice(-800)}`);
    });
}

for (const rel of REPORTING_SCRIPTS) {
    test(`${rel} runs and produces a report`, () => {
        // Any exit code is acceptable here; a crash is not. Distinguish the two
        // by requiring the report line to appear in the output.
        let out = '';
        try {
            out = execFileSync(process.execPath, [rel], {
                cwd: ROOT, encoding: 'utf8', timeout: 120000,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (e) {
            out = [e.stdout, e.stderr].filter(Boolean).join('\n');
        }
        assert.ok(/distinct skier behaviours/.test(out),
            `${rel} did not produce its report — it likely crashed:\n${out.slice(-800)}`);
        assert.ok(!/ReferenceError|is not defined/.test(out),
            `${rel} printed an error signature:\n${out.slice(-800)}`);
    });
}
