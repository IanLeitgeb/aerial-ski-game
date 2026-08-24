'use strict';
// Mechanically extract the body-model constants from game.js into a pure module.
//
// Deliberately NOT delegated to a subagent: this is ~100 lines of hand-tuned
// numeric data where a single mistyped digit would silently change the physics
// and no test would obviously catch it. A parser is exact; a language model
// transcribing numbers is not. Agents get reasoning work, not transcription.
//
// Colour fields are dropped — they are renderer data, and ADR-0002 keeps
// engine/ free of display concerns. computeI only reads name/mass/h/d.

const fs   = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const src  = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');

/** Grab `const NAME = <literal>;` by matching brackets from the first one. */
function grabConst(name) {
    const start = src.search(new RegExp(`^const\\s+${name}\\s*=`, 'm'));
    if (start === -1) throw new Error('not found: ' + name);
    const openIdx = src.search(new RegExp(`^const\\s+${name}\\s*=\\s*[\\[{]`, 'm'));
    if (openIdx === -1) throw new Error('no literal for: ' + name);
    let i = src.indexOf(src[src.indexOf('=', start) + 1].trim() === '' ? '[' : '[', start);
    // Find the first [ or { after the '='
    const eq = src.indexOf('=', start);
    let j = eq + 1;
    while (j < src.length && src[j] !== '[' && src[j] !== '{') j++;
    const open = src[j];
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    for (i = j; i < src.length; i++) {
        if (src[i] === open) depth++;
        else if (src[i] === close) { depth--; if (depth === 0) break; }
    }
    return src.slice(j, i + 1);
}

// Strip the `color: ...` property — renderer data, and it references _CC.
function stripColor(code) {
    return code
        .replace(/,\s*color:\s*_CC\.[A-Za-z_$]+/g, '')
        .replace(/,\s*color:\s*\[[^\]]*\]/g, '');
}

const SEGMENTS = stripColor(grabConst('SEGMENTS'));
const BASE_Z   = grabConst('BASE_Z');

// Every pose table. applyPose blends between these, so extracting the pose
// solver requires all of them, not just the two computeI needs.
const POSE_TABLES = [
    'POSE_UNTUCKED', 'POSE_INRUN_TUCK', 'POSE_TUCKED', 'POSE_PIKED',
    'POSE_ARMS_FORWARD', 'POSE_ARMS_DROPPED', 'POSE_ARMS_50DEG',
    'POSE_ARMS_T', 'POSE_ARMS_UP',
];
const poses = Object.fromEntries(POSE_TABLES.map(n => [n, grabConst(n)]));
const POSE_UNTUCKED = poses.POSE_UNTUCKED;
const POSE_TUCKED   = poses.POSE_TUCKED;

const out = `(function (global) {
'use strict';
// ── Body model ───────────────────────────────────────────────────────────────
// Physics-relevant segment data, extracted MECHANICALLY from game.js by
// .delegate/extract-body-model.js — not hand-copied and not model-generated,
// because a single mistyped digit here would silently alter the physics.
//
// Colour fields are intentionally absent: they are renderer data (ADR-0002).
// Regenerate with:  node .delegate/extract-body-model.js

const SEGMENTS = ${SEGMENTS};

const BASE_Z = ${BASE_Z};

${POSE_TABLES.map(n => `const ${n} = ${poses[n]};`).join('\n\n')}

const api = { SEGMENTS, BASE_Z, ${POSE_TABLES.join(', ')} };

// Dual-mode: require() in node --test, <script> in the browser, and
// vm.runInContext in the headless harness. The project has no bundler.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).bodyModel = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

const target = path.join(ROOT, 'engine', 'core', 'body-model.js');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out);
console.log('wrote engine/core/body-model.js');
console.log('  SEGMENTS entries      :', (SEGMENTS.match(/\{/g) || []).length);
console.log('  contains _CC (must be 0):', (out.match(/_CC/g) || []).length);
