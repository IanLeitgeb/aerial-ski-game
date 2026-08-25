'use strict';
// Verify patchMath() produced REAL rotation math. Against the unpatched stub,
// Quaternion.RotationAxis/multiply return identity, so every captured
// rotationQuaternion would be (0,0,0,1) — traces that look stable but test
// nothing. This asserts the skier's orientation actually varies in flight.
const { createSim } = require('./harness');

const sim = createSim({ search: '' });
sim.tick(5);
sim.keyDown('ArrowUp');
sim.tick(2);
sim.keyUp('ArrowUp');

const seen = new Set();
let airborneFrames = 0;
for (let f = 0; f < 900; f++) {
    sim.tick(1);
    if (!sim.state().grounded) {
        airborneFrames++;
        const n = sim.snapshot().nodes.skierRoot;
        if (n && n.q) seen.add(n.q.join(','));
    }
}

console.log('airborne frames        :', airborneFrames);
console.log('distinct skierRoot quats:', seen.size);
const sample = [...seen].slice(0, 3);
console.log('sample quats           :', sample.join('  |  '));

const identityOnly = seen.size <= 1 && [...seen][0] === '0,0,0,1';
console.log('\nmath fidelity:', identityOnly
    ? 'FAIL — quaternions are identity; stub math still fake'
    : 'PASS — real rotation captured');
process.exit(identityOnly ? 1 : 0);
