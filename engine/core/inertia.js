'use strict';

const { lerp } = require('./math.js');
const bodyModel = require('./body-model.js');

// Moment of inertia about the flip axis (X, shoulder-to-shoulder).
// Distance from X axis = sqrt(y² + z²), so I = Σ [ m_i·(y_i²+z_i²) + m_i·(h_i²+d_i²)/12 ]
function computeI(tuck, model) {
    const { SEGMENTS, POSE_UNTUCKED, POSE_TUCKED, BASE_Z } = model || bodyModel;
    let I = 0;
    for (const seg of SEGMENTS) {
        const up = POSE_UNTUCKED[seg.name];
        const tk = POSE_TUCKED[seg.name];
        const y  = lerp(up.y,  tk.y,  tuck);
        const dz = lerp(up.dz, tk.dz, tuck);
        const z  = (BASE_Z[seg.name] || 0) + dz;
        I += seg.mass * (y * y + z * z);
        // Self-inertia of box around X axis: m*(h² + d²)/12
        I += seg.mass * (seg.h * seg.h + seg.d * seg.d) / 12;
    }
    return Math.max(I, 0.5); // prevent division by zero
}

module.exports = { computeI };
