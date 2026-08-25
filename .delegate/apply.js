'use strict';
// Parse a delegated agent's output and write the ===FILE:=== blocks to disk.
//
//   node .delegate/apply.js <unit> [--dry]
//
// Per ADR-0009 subagents propose, they do not merge. This is the deliberate
// acceptance step, run only after review. --dry prints what would be written.

const fs   = require('node:fs');
const path = require('node:path');

const unit = process.argv[2];
const dry  = process.argv.includes('--dry');
if (!unit) { console.error('usage: apply.js <unit> [--dry]'); process.exit(1); }

const raw = fs.readFileSync(path.join('.delegate', 'out', unit + '.md'), 'utf8');

// Tolerate models that wrap output in markdown fences despite instructions.
const cleaned = raw.replace(/^```[a-z]*\s*$/gm, '');

const re = /^===FILE:\s*(.+?)\s*===$/gm;
const marks = [];
let m;
while ((m = re.exec(cleaned)) !== null) {
    marks.push({ file: m[1], start: m.index + m[0].length });
}
if (!marks.length) {
    console.error('no ===FILE:=== blocks found — model ignored the output format');
    process.exit(1);
}

let wrote = 0;
for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length
        ? cleaned.lastIndexOf('===FILE:', marks[i + 1].start)
        : cleaned.length;
    const body = cleaned.slice(marks[i].start, end).replace(/^\n+/, '').replace(/\s+$/, '') + '\n';

    // Refuse paths outside the repo or into protected areas.
    const target = path.normalize(marks[i].file);
    if (target.startsWith('..') || path.isAbsolute(target)) {
        console.error('REFUSED (escapes repo):', target);
        process.exit(1);
    }
    if (/^(game\.js|index\.html|lib\/|tests\/babylon-stub\.js|tests\/test\.html)/.test(target)) {
        console.error('REFUSED (protected path):', target);
        process.exit(1);
    }

    console.log(`${dry ? '[dry] ' : ''}${target}  (${body.split('\n').length} lines)`);
    if (!dry) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, body);
        wrote++;
    }
}
console.log(dry ? 'dry run — nothing written' : `wrote ${wrote} file(s)`);
