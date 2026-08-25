'use strict';
const path = require('node:path');
const { createEnv }  = require('./browser-env');
const { extendStub } = require('./stub-extend');
const { ENGINE_MODULES } = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const env = createEnv({ search: '' });
// This script deliberately probes MeshBuilder BETWEEN the stub and game.js, so
// it cannot use loadGameInto(); it replicates the same order by hand instead.
env.load(path.join(ROOT, 'tests', 'babylon-stub.js'));
extendStub(env.ctx);

const B = env.ctx.BABYLON;
console.log('MeshBuilder keys:', Object.keys(B.MeshBuilder).join(', '));

const probe = B.MeshBuilder.CreateBox('probe', {}, B._scene);
console.log('CreateBox node has computeWorldMatrix:', typeof probe.computeWorldMatrix);
console.log('CreateBox node has getAbsolutePosition:', typeof probe.getAbsolutePosition);

for (const mod of ENGINE_MODULES) env.load(path.join(ROOT, mod));
env.load(path.join(ROOT, 'game.js'));

const cm = env.ctx._characterMeshes;
if (!cm) { console.log('no _characterMeshes'); process.exit(0); }
const names = Object.keys(cm);
console.log('character mesh count:', names.length);
const bad = names.filter(n => typeof cm[n].computeWorldMatrix !== 'function');
console.log('missing computeWorldMatrix:', bad.length ? bad.join(', ') : '(none)');
if (bad.length) {
    const b = cm[bad[0]];
    console.log('sample bad node keys:', Object.keys(b).slice(0, 20).join(', '));
    console.log('  _transformsPatched:', b._transformsPatched);
    console.log('  constructor:', b.constructor && b.constructor.name);
}
