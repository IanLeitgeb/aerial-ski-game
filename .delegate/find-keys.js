'use strict';
// Find (a) combos genuinely absent from DD_TABLE, and (b) a key where the table
// value DIFFERS from the fallback formula — needed for a discriminating test.
const mod = require('../engine/core/tricks.js');
const T = mod.DD_TABLE;

const formula = (a) => {
    const flips = a.length, twists = a.reduce((x, y) => x + y, 0);
    return Math.round((1.4 + flips * 0.5 + twists * 0.4) * 1000) / 1000;
};

const candidates = [[9],[7,7],[4,4,4],[6,1,2],[12,12],[8,8,8],[5,5,5,5],[11],[0,9]];
console.log('genuinely absent:',
    candidates.filter(c => T[c.join(',')] === undefined).map(c => JSON.stringify(c)).join(' '));

const divergent = Object.keys(T)
    .filter(k => {
        const arr = k.split(',').map(Number);
        return arr.every(Number.isFinite) && T[k] !== formula(arr);
    })
    .slice(0, 6);
console.log('table != formula for:',
    divergent.map(k => `${k} (table=${T[k]}, formula=${formula(k.split(',').map(Number))})`).join('  '));
