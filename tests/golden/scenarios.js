'use strict';
// ── Golden-trace scenarios ───────────────────────────────────────────────────
// Each scenario is a deterministic input script replayed at a fixed 16.667 ms
// step. Coverage follows ADR-0005.
//
// Script actions, applied at the START of frame `at`:
//   { at, down: 'Space' }          keydown
//   { at, up:   'Space' }          keyup
//   { at, pad:  true|false }       connect/disconnect the gamepad
//   { at, axis: [index, value] }   set a gamepad axis
//   { at, btn:  [index, pressed, value?] }  set a gamepad button
//
// ── VERIFIED INPUT MAP (read from game.js, not assumed) ─────────────────────
// The first scenario set failed to differentiate because these were guessed.
//
//   ArrowUp                start the run / turn to face downhill   (:2695)
//   ArrowDown (grounded)   charge the power meter                  (:3151, :3287)
//   ArrowDown (airborne)   powerWrapDown — NOT tuck                (:2692)
//   Space                  TUCK — state.tuckTarget = 1.0           (:2679)
//   ShiftLeft              PIKE — state.pikeTarget = 1.0           (:2683)
//   KeyA                   off-axis 0.28                           (:2686)
//   KeyD                   off-axis toggle (all worlds)            (:2757)
//   KeyX                   trampoline ONLY — no-op in aerial       (:2767)
//   KeyF                   pool-dive ONLY — no-op in aerial        (:2770)
//   ArrowLeft / ArrowRight A SINGLE arrow only drops one arm as wind-up.
//                          The twist fires when the SECOND arrow is pressed
//                          while the first is still held.          (:2775, :2788)
//                          Holding both then arms a DOUBLE_HOLD_MS setTimeout
//                          for double-twist mode — which is why the harness
//                          needs real virtual timers.
//
// localStorage settings gate real behaviour via _lsGet() (game.js:4):
//   setting_gamepad    '1' → pollGamepad() runs AT ALL              (:3247)
//                            and the power floor becomes 0.75       (:3453)
//   setting_rightspin  '1' → inverts spin direction                 (:3297)
//   setting_mirrorkeys '1' → swaps ArrowLeft/ArrowRight             (:2675)

/** Hold a key from frame `at` for `dur` frames. */
function hold(at, code, dur) {
    return [{ at, down: code }, { at: at + dur, up: code }];
}

/** Every scenario starts the run the same way, so traces stay comparable. */
function startRun(at = 5) {
    return hold(at, 'ArrowUp', 2);
}

// Power meter: ArrowDown held while grounded charges flipPower at
// 1/FLIP_POWER_RATE per second (rate 1.7 s for a full bar), and launch torque
// scales as max(_minPwr, flipPower)/0.75. Without a charge every run launches at
// the ~6.7% floor.
const FPS = 60;
const FULL_CHARGE_FRAMES = Math.round(1.7 * FPS);   // 102 → flipPower 1.0

/** Hold ArrowDown on the approach to charge to roughly `pct` of the bar. */
function charge(pct, at = 60) {
    return hold(at, 'ArrowDown', Math.round(FULL_CHARGE_FRAMES * pct));
}

/**
 * Fire a twist. A single arrow is only a wind-up — the twist fires on the second
 * arrow while the first is held. `dir` 'left' presses ← then →; 'right' the
 * reverse. `holdFrames` controls whether the DOUBLE_HOLD_MS timer also elapses.
 */
function twist(at, dir = 'left', holdFrames = 20) {
    const [first, second] = dir === 'left'
        ? ['ArrowLeft', 'ArrowRight']
        : ['ArrowRight', 'ArrowLeft'];
    return [
        { at, down: first },
        { at: at + 4, down: second },
        { at: at + 4 + holdFrames, up: second },
        { at: at + 4 + holdFrames + 2, up: first },
    ];
}

const GP = { setting_gamepad: '1' };

const scenarios = [
    // ── Baselines ───────────────────────────────────────────────────────────
    {
        name: 'aerial-idle',
        description: 'No input. Baseline: pose solver and idle animation only.',
        search: '', seed: 1, frames: 240,
        script: [],
    },
    {
        name: 'aerial-nopower-run',
        description: 'Start with no charge — launches at the ~6.7% power floor.',
        search: '', seed: 1, frames: 900,
        script: [...startRun()],
    },

    // ── Power meter scaling ─────────────────────────────────────────────────
    {
        name: 'aerial-power-25',
        description: 'Quarter charge. Guards the linear power→torque scaling.',
        search: '', seed: 1, frames: 900,
        script: [...startRun(), ...charge(0.25)],
    },
    {
        name: 'aerial-power-75',
        description: 'Three-quarter charge — calibration point where flip speed is exactly 100%.',
        search: '', seed: 1, frames: 900,
        script: [...startRun(), ...charge(0.75)],
    },
    {
        name: 'aerial-power-full',
        description: 'Full charge — maximum launch torque.',
        search: '', seed: 1, frames: 900,
        script: [...startRun(), ...charge(1.0)],
    },

    // ── Body configuration: tuck (Space) and pike (ShiftLeft) ───────────────
    {
        name: 'aerial-tuck',
        description: 'Space held in flight — exercises computeI and omega = L/I speed-up.',
        search: '', seed: 1, frames: 900,
        script: [...startRun(), ...charge(1.0), ...hold(300, 'Space', 200)],
    },
    {
        name: 'aerial-tuck-short',
        description: 'Brief tuck — under-rotates. Exercises LAND_TOL under-rotation.',
        search: '', seed: 1, frames: 900,
        script: [...startRun(), ...charge(0.75), ...hold(300, 'Space', 30)],
    },
    {
        name: 'aerial-tuck-long',
        description: 'Long tuck at full power — over-rotates past the landing window.',
        search: '', seed: 1, frames: 1100,
        script: [...startRun(), ...charge(1.0), ...hold(295, 'Space', 400)],
    },
    {
        name: 'aerial-pike',
        description: 'ShiftLeft pike — exercises PIKE_RATE / PIKE_RELEASE_RATE and the pike inertia branch.',
        search: '', seed: 1, frames: 900,
        script: [...startRun(), ...charge(1.0), ...hold(300, 'ShiftLeft', 200)],
    },
    {
        name: 'aerial-offaxis-keya',
        description: 'KeyA off-axis 0.28 — exercises the off-axis rotation path.',
        search: '', seed: 1, frames: 900,
        script: [...startRun(), ...charge(1.0), ...hold(300, 'KeyA', 150)],
    },
    {
        name: 'aerial-offaxis-keyd',
        description: 'KeyD off-axis — distinct from KeyA.',
        search: '', seed: 1, frames: 900,
        script: [...startRun(), ...charge(1.0), ...hold(300, 'KeyD', 150)],
    },

    // ── Twist: requires the paired-arrow sequence ───────────────────────────
    {
        name: 'aerial-twist-left',
        description: 'Left twist: ← held, then → fires a full 2pi left twist.',
        search: '', seed: 1, frames: 900,
        script: [...startRun(), ...charge(0.75), ...twist(300, 'left')],
    },
    {
        name: 'aerial-twist-right',
        description: 'Right twist — mirror sequence; guards directional asymmetry.',
        search: '', seed: 1, frames: 900,
        script: [...startRun(), ...charge(0.75), ...twist(300, 'right')],
    },
    {
        name: 'aerial-twist-double-mode',
        description: 'Both arrows held past DOUBLE_HOLD_MS — enters double-twist mode via the virtual timer.',
        search: '', seed: 1, frames: 1000,
        script: [...startRun(), ...charge(1.0), ...twist(300, 'left', 90)],
    },
    {
        name: 'aerial-twist-rightspin-setting',
        description: 'Same input as twist-left but setting_rightspin=1 — guards the spin-direction setting.',
        search: '', seed: 1, frames: 900,
        localStorage: { setting_rightspin: '1' },
        script: [...startRun(), ...charge(0.75), ...twist(300, 'left')],
    },
    {
        name: 'aerial-full-twisting-double',
        description: 'Full power, tuck plus twist — the headline trick.',
        search: '', seed: 1, frames: 1000,
        script: [
            ...startRun(), ...charge(1.0),
            ...hold(300, 'Space', 240),
            ...twist(310, 'left', 60),
        ],
    },

    // ── Crash ───────────────────────────────────────────────────────────────
    {
        name: 'aerial-crash-ragdoll',
        description: 'Drives a crash to lock in the BUG-001 fix — ragdoll must run, not throw.',
        search: '', seed: 7, frames: 1200,
        script: [...startRun(), ...charge(1.0), ...hold(300, 'Space', 500)],
    },

    // ── Gamepad: requires setting_gamepad=1 or pollGamepad never runs ───────
    {
        name: 'aerial-gamepad-armdrop-left',
        description: 'Gamepad left-arm drop — the spin-coupling path being actively tuned.',
        search: '', seed: 1, frames: 900, localStorage: GP,
        script: [
            { at: 1, pad: true }, ...startRun(),
            { at: 300, axis: [1, 1.0] },
            { at: 360, axis: [1, 0.0] },
        ],
    },
    {
        name: 'aerial-gamepad-armdrop-right',
        description: 'Gamepad right-arm drop — mirror; guards spin-direction asymmetry.',
        search: '', seed: 1, frames: 900, localStorage: GP,
        script: [
            { at: 1, pad: true }, ...startRun(),
            { at: 300, axis: [3, 1.0] },
            { at: 360, axis: [3, 0.0] },
        ],
    },
    {
        name: 'aerial-gamepad-both-arms',
        description: 'Both arms dropped together — asymmetry under the 0.04 deadband.',
        search: '', seed: 1, frames: 900, localStorage: GP,
        script: [
            { at: 1, pad: true }, ...startRun(),
            { at: 300, axis: [1, 1.0] }, { at: 300, axis: [3, 1.0] },
            { at: 380, axis: [1, 0.0] }, { at: 380, axis: [3, 0.0] },
        ],
    },
    {
        name: 'aerial-gamepad-counter-spin',
        description: 'One arm drops, then the other — exercises the isCounter slower-rate branch (game.js:4192).',
        search: '', seed: 1, frames: 900, localStorage: GP,
        script: [
            { at: 1, pad: true }, ...startRun(),
            { at: 300, axis: [1, 1.0] },
            { at: 340, axis: [1, 0.0] }, { at: 340, axis: [3, 1.0] },
            { at: 400, axis: [3, 0.0] },
        ],
    },
    {
        name: 'aerial-gamepad-power-floor',
        description: 'Gamepad mode with no charge — power floor is 0.75, not 0.05 (game.js:3454).',
        search: '', seed: 1, frames: 900, localStorage: GP,
        script: [{ at: 1, pad: true }, ...startRun()],
    },

    // ── Trampoline: shared core, different takeoff/landing ──────────────────
    {
        name: 'trampoline-basic',
        description: 'Trampoline bounce, no rotation. Shared rotation/inertia core.',
        search: '?world=trampoline', seed: 1, frames: 900,
        script: [...startRun()],
    },
    {
        name: 'trampoline-tuck',
        description: 'Trampoline with tuck — omega capped at 13 rad/s (game.js:4035).',
        search: '?world=trampoline', seed: 1, frames: 900,
        script: [...startRun(), ...hold(200, 'Space', 300)],
    },
    {
        name: 'trampoline-pike',
        description: 'Trampoline pike — pike inertia branch under the omega cap.',
        search: '?world=trampoline', seed: 1, frames: 900,
        script: [...startRun(), ...hold(200, 'ShiftLeft', 300)],
    },
    {
        name: 'trampoline-keyx-single',
        description: 'KeyX single-layout mode — trampoline-only path (game.js:2767).',
        search: '?world=trampoline', seed: 1, frames: 900,
        script: [...hold(3, 'KeyX', 2), ...startRun(8), ...hold(200, 'Space', 300)],
    },

    // ── Pool diving: shared core, water entry ───────────────────────────────
    {
        name: 'pool-dive-basic',
        description: 'Pool dive entry, no rotation.',
        search: '?world=pool', seed: 1, frames: 900,
        script: [...startRun(), ...charge(0.75)],
    },
    {
        name: 'pool-dive-tuck',
        description: 'Pool dive with tuck rotation through water entry.',
        search: '?world=pool', seed: 1, frames: 900,
        script: [...startRun(), ...charge(0.75), ...hold(250, 'Space', 250)],
    },
    {
        name: 'pool-dive-pike',
        description: 'Pool dive in pike — the classic dive shape.',
        search: '?world=pool', seed: 1, frames: 900,
        script: [...startRun(), ...charge(0.75), ...hold(250, 'ShiftLeft', 250)],
    },
    {
        name: 'pool-dive-keyf',
        description: 'KeyF — pool-dive-only path (game.js:2770).',
        search: '?world=pool', seed: 1, frames: 900,
        script: [...hold(3, 'KeyF', 2), ...startRun(8), ...charge(0.75), ...hold(250, 'Space', 250)],
    },
];

module.exports = { scenarios, hold, startRun, charge, twist };
