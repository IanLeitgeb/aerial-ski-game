'use strict';
const fs = require('node:fs'), vm = require('node:vm');
const GAME = fs.readFileSync('game.js', 'utf8');

function grab(src, pat) {
    const m = src.match(pat);
    let i = src.indexOf('{', m.index), d = 0;
    for (let j = i; j < src.length; j++) {
        if (src[j] === '{') d++;
        else if (src[j] === '}') { d--; if (d === 0) return src.slice(m.index, j + 1); }
    }
}

const sb = {};
vm.createContext(sb);
vm.runInContext(grab(GAME, /const\s+DD_TABLE\s*=\s*\{/) + ';', sb);
const LIVE_DD = vm.runInContext('DD_TABLE', sb);

const mod = require('../engine/core/tricks.js');
const liveKeys = Object.keys(LIVE_DD);
const modKeys  = Object.keys(mod.DD_TABLE);

console.log('live entries  :', liveKeys.length);
console.log('module entries:', modKeys.length);
console.log('missing from module:', liveKeys.filter(k => !(k in mod.DD_TABLE)).slice(0, 10));
console.log('extra in module    :', modKeys.filter(k => !(k in LIVE_DD)).slice(0, 10));

const wrong = liveKeys
    .filter(k => k in mod.DD_TABLE && mod.DD_TABLE[k] !== LIVE_DD[k])
    .slice(0, 10)
    .map(k => `${k}: module=${mod.DD_TABLE[k]} live=${LIVE_DD[k]}`);
console.log('value mismatches   :', wrong.length ? wrong : '(none)');
