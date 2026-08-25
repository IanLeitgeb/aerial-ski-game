(function (global) {
'use strict';

// Flip-power calibration constants (extracted verbatim from game.js).
//
// Apply flip power: 3rd dash (75%) = world-normal flip speed.
// Gamepad: minimum 75% so a normal take-off always produces a full flip;
// holding L2 on approach charges up to 133% for extra speed.

const CALIBRATION_POWER = 0.75;
const MIN_POWER_KEYBOARD = 0.05;
const MIN_POWER_GAMEPAD = 0.75;

// Seconds for the meter to fill from 0 to 1.
const FILL_SECONDS = 1.7;

function minPower(gamepadMode) {
    return gamepadMode ? MIN_POWER_GAMEPAD : MIN_POWER_KEYBOARD;
}

function flipSpeedMultiplier(flipPower, gamepadMode) {
    return Math.max(minPower(gamepadMode), flipPower) / CALIBRATION_POWER;
}

const api = { FILL_SECONDS, CALIBRATION_POWER, MIN_POWER_KEYBOARD, MIN_POWER_GAMEPAD, minPower, flipSpeedMultiplier };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).power = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
