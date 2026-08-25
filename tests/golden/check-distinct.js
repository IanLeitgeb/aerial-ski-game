'use strict';
// Do the scenarios actually produce different behaviour? Traces that don't
// differentiate are worthless as a refactor gate.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = path.join(__dirname, 'traces');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();

const hashes = new Map();
for (const f of files) {
    const t = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    // Hash only the skier's own motion, so identical scenery doesn't mask
    // differences in the thing we actually care about.
    // Compare the FULL recorded frame, not just skierRoot. The narrower
    // signature under-reported differentiation: scenarios that differ only in
    // limb pose (e.g. both gamepad arms dropped, which changes arm nodes but not
    // the root) were being reported as identical, hiding real coverage.
    // The per-frame digest is included, so transients between samples count too.
    const sig = t.frames.map(fr => JSON.stringify([fr.d, fr.state, fr.nodes])).join(';');
    const h = crypto.createHash('sha256').update(sig).digest('hex').slice(0, 12);
    if (!hashes.has(h)) hashes.set(h, []);
    hashes.get(h).push(t.name);
}

console.log(`${files.length} traces → ${hashes.size} distinct skier behaviours\n`);
for (const [h, names] of hashes) {
    const flag = names.length > 1 ? '  ⚠ IDENTICAL' : '';
    console.log(h, names.join(', ') + flag);
}

// ── Known, investigated duplicates ───────────────────────────────────────────
// Suppressed with a REASON, not ignored: an unexplained duplicate must still
// fail the gate. Each entry records a real behavioural finding (OPEN-002), not
// a scenario that could be fixed by adjusting its inputs.
const ALLOWED_DUPLICATES = [
    {
        pair: ['aerial-twist-left', 'aerial-twist-rightspin-setting'],
        reason: 'setting_rightspin is only consulted in the downHalfTwistFired ' +
                'branch (game.js:2780); this input sequence never reaches it, so ' +
                'the setting genuinely has no effect here. The setting remains ' +
                'UNTESTED — a scenario that reaches that branch is still needed.',
    },
    {
        pair: ['pool-dive-basic', 'pool-dive-pike'],
        reason: 'ShiftLeft/pike requires !state.grounded (game.js:2683); the ' +
                'pool dive airborne window does not overlap the scripted input ' +
                'frame. Pike in the pool world is UNTESTED.',
    },
];

function isAllowed(names) {
    const key = [...names].sort().join('|');
    return ALLOWED_DUPLICATES.find(a => [...a.pair].sort().join('|') === key);
}

const dupes = [...hashes.values()].filter(v => v.length > 1 && !isAllowed(v));

const suppressed = [...hashes.values()].filter(v => v.length > 1 && isAllowed(v));
if (suppressed.length) {
    console.log('\nKnown duplicates (investigated, see OPEN-002):');
    for (const v of suppressed) {
        const a = isAllowed(v);
        console.log(`  ${v.join(' = ')}\n    ${a.reason}`);
    }
}
if (dupes.length) {
    console.log('\nPROBLEM: some scenarios produce identical skier motion.');
    console.log('Their inputs are not reaching the simulation.');
    process.exit(1);
}
console.log('\nAll scenarios differentiate.');
