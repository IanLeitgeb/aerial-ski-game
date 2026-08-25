'use strict';
// Scan DD_TABLE for values that look like transcription artefacts or domain
// oddities. NOTE: all 164 entries were verified against game.js's original
// before that copy was deleted, so anything found here is in the ORIGINAL table
// and is a game-design question, not a refactor defect.
const T = require('../engine/core/tricks.js').DD_TABLE;

const rows = Object.keys(T).map(k => {
    const a = k.split(',').map(Number);
    return { k, a, flips: a.length, twists: a.reduce((x, y) => x + y, 0), dd: T[k] };
}).filter(r => r.a.every(Number.isFinite));

console.log(`entries: ${rows.length}`);

// 1. Decimal places — a lone 3-dp value among 1-dp neighbours smells of a typo.
const dp = {};
for (const r of rows) {
    const s = String(r.dd);
    const d = s.includes('.') ? s.split('.')[1].length : 0;
    (dp[d] = dp[d] || []).push(`${r.k}=${r.dd}`);
}
for (const [d, list] of Object.entries(dp)) {
    console.log(`  ${d} decimal place(s): ${list.length}` +
        (list.length <= 4 ? `  -> ${list.join(' ')}` : ''));
}

// 2. Monotonicity — more twists at equal flips should not reduce difficulty.
const byFlips = {};
for (const r of rows) (byFlips[r.flips] = byFlips[r.flips] || []).push(r);
for (const [flips, list] of Object.entries(byFlips)) {
    list.sort((x, y) => x.twists - y.twists);
    const bad = [];
    for (let i = 1; i < list.length; i++) {
        if (list[i].twists > list[i - 1].twists && list[i].dd < list[i - 1].dd) {
            bad.push(`${list[i - 1].k}(${list[i - 1].dd}) -> ${list[i].k}(${list[i].dd})`);
        }
    }
    console.log(`  ${flips} flip(s): ${list.length} entries, ` +
        (bad.length ? `NON-MONOTONIC: ${bad.slice(0, 3).join('  ')}` : 'monotonic in twists'));
}

// 3. Same flips+twists but different dd — legitimate if twist PLACEMENT matters.
const groups = {};
for (const r of rows) {
    const g = `${r.flips}f${r.twists}t`;
    (groups[g] = groups[g] || []).push(r);
}
const spread = Object.entries(groups)
    .map(([g, list]) => {
        const vals = [...new Set(list.map(r => r.dd))];
        return { g, n: list.length, vals };
    })
    .filter(x => x.vals.length > 1);
console.log(`  groups with same flips+twists but differing dd: ${spread.length}`);
for (const s of spread.slice(0, 4)) {
    console.log(`    ${s.g}: ${s.vals.join(', ')}`);
}
