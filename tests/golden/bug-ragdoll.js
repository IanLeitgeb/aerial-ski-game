'use strict';
// Confirm the ragdoll bug empirically: on crash, game.js:4064 calls
// computeWorldMatrix() on every value of character.meshes — but gloveL/gloveR
// are { mesh, halfH } wrappers (game.js:375), not meshes.
const path = require('node:path');
const { createEnv }    = require('./browser-env');
const { loadGameInto } = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const env = createEnv({ search: '' });
loadGameInto(env);   // stub + engine core + game.js, in index.html's order

const B = env.ctx.BABYLON;

// Structural proof, independent of reaching a crash in play.
const cm = env.ctx._characterMeshes;
for (const n of ['gloveL', 'gloveR']) {
    console.log(`character.meshes.${n}:`,
        'keys=[' + Object.keys(cm[n]).join(',') + ']',
        '| computeWorldMatrix=' + typeof cm[n].computeWorldMatrix);
}

// Behavioural proof: run until a crash occurs, then report the swallowed error.
env.key('keydown', 'ArrowUp');
B._engine._tick(2);
env.key('keyup', 'ArrowUp');

let crashedAt = -1;
for (let f = 0; f < 1200; f++) {
    B._engine._tick(1);
    const s = env.ctx._getGameState();
    if (s.crashed && crashedAt < 0) crashedAt = f;
    if (B._lastError) {
        console.log('\ncrash detected at frame:', crashedAt);
        console.log('swallowed error       :', B._lastError.message);
        console.log('thrown from           :',
            String(B._lastError.stack || '').split('\n')[1].trim());
        console.log('\nIn the browser this is caught by the try/catch spanning');
        console.log('game.js:3199-4401, which sets the HUD to "ERR: ..." and');
        console.log('aborts the rest of that frame — so the ragdoll never runs.');
        console.log('crashActive was already set true, so it never retries.');
        process.exit(0);
    }
}
console.log('\nno crash reached in 1200 frames (clean landing)');
