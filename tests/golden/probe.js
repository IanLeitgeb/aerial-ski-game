'use strict';
// Probe: confirm ArrowUp starts the run and the skier leaves the ground.
const { createSim } = require('./harness');

const sim = createSim({ search: '' });
sim.tick(5);
sim.keyDown('ArrowUp');
sim.tick(2);
sim.keyUp('ArrowUp');

let leftGround = -1;
let landed = -1;
for (let f = 0; f < 900; f++) {
    sim.tick(1);
    const s = sim.state();
    if (leftGround < 0 && !s.grounded) leftGround = f;
    if (leftGround >= 0 && landed < 0 && s.grounded) landed = f;
}
const s = sim.state();
console.log('left ground at frame:', leftGround);
console.log('landed at frame     :', landed);
console.log('final posZ          :', s.posZ);
console.log('airTime             :', s.airTime);
console.log('crashed / stopped   :', s.crashed, '/', s.stopped);
console.log('trickName           :', JSON.stringify(s.trickName));
