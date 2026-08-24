'use strict';
// Smoke test: can we boot game.js headlessly and step frames deterministically?
const { createSim } = require('./harness');

const sim = createSim({ search: '' });
console.log('booted OK');

const s0 = sim.state();
console.log('initial state:', JSON.stringify(s0));

sim.tick(60);
const s1 = sim.state();
console.log('after 60 frames:', JSON.stringify(s1));

console.log('nodes captured:', Object.keys(sim.snapshot().nodes).length);

// Determinism check: a second identical run must produce identical output.
const sim2 = createSim({ search: '' });
sim2.tick(60);
const a = JSON.stringify(sim.snapshot());
const b = JSON.stringify(sim2.snapshot());
console.log('deterministic:', a === b ? 'YES' : 'NO — traces would be unreliable');
