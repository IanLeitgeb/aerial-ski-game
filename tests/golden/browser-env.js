'use strict';
// ── Headless browser environment for golden-trace capture ────────────────────
// Builds a vm context that game.js can run inside unmodified. In a browser
// `window === globalThis`, so the context object is made to reference itself.
//
// Deliberately NOT a full DOM. Unknown element properties resolve to inert
// stubs so rendering/UI code no-ops instead of throwing — only simulation state
// matters here. Anything the sim genuinely depends on is modelled properly:
// keyboard listeners, gamepad polling, and the URL query string.

const vm   = require('node:vm');
const fs   = require('node:fs');
const path = require('node:path');

function makeElement(tag = 'div') {
    const el = {
        tagName: String(tag).toUpperCase(),
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        children: [],
        value: '', textContent: '', innerHTML: '',
        width: 800, height: 600,
        appendChild(c) { this.children.push(c); return c; },
        removeChild() {}, remove() {},
        setAttribute() {}, getAttribute() { return null; },
        addEventListener() {}, removeEventListener() {},
        insertAdjacentHTML() {}, focus() {}, blur() {}, click() {},
        requestPointerLock() {}, requestFullscreen() {},
        getBoundingClientRect() {
            return { x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 };
        },
        getContext() {
            // 2D context, used for particle sprite generation. Inert stub: any
            // unknown method returns a no-op function rather than throwing.
            return new Proxy({
                canvas: { width: 128, height: 128, toDataURL: () => 'data:,' },
                createLinearGradient: () => ({ addColorStop() {} }),
                createRadialGradient: () => ({ addColorStop() {} }),
                getImageData: () => ({ data: new Uint8ClampedArray(4) }),
                measureText: () => ({ width: 0 }),
            }, { get: (t, p) => (p in t ? t[p] : () => {}) });
        },
        toDataURL: () => 'data:,',
    };
    return new Proxy(el, {
        get(t, p) {
            if (p in t) return t[p];
            if (typeof p === 'string' && /^on/.test(p)) return null;
            return undefined;
        },
        set(t, p, v) { t[p] = v; return true; },
    });
}

/** mulberry32 — small, fast, well-distributed seeded PRNG. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Create an isolated headless environment.
 * @param {object}  opts
 * @param {string} [opts.search] query string, e.g. '?world=trampoline'
 * @param {number} [opts.seed]   PRNG seed replacing Math.random (default 1)
 */
function createEnv(opts = {}) {
    const search = opts.search || '';
    const seed   = opts.seed !== undefined ? opts.seed : 1;

    // window event listeners by type, so scenarios can dispatch synthetic input
    const listeners = new Map();

    // Controllable gamepad. Scenarios mutate this; game.js polls it each frame.
    const gamepadState = {
        id: 'golden-trace-pad',
        index: 0,
        connected: false,
        mapping: 'standard',
        timestamp: 0,
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };

    const ctx = {};

    // In a browser these are all the same object.
    ctx.window     = ctx;
    ctx.globalThis = ctx;
    ctx.self       = ctx;

    // ── Swallowed-error capture ─────────────────────────────────────────────
    // game.js wraps its ENTIRE per-frame update in one try/catch
    // (game.js:3204-4417) that absorbs any exception into
    // `hud.text = 'ERR: …'; console.error(e)`. The stub therefore never sees the
    // throw, BABYLON._lastError stays null, and every downstream error check in
    // the harness is dead code.
    //
    // Consequence before this existed: an unconditional `throw` inside the frame
    // loop left the whole suite green, and four pool-dive scenarios were in fact
    // throwing 900 times each while verify.js reported 30/30.
    //
    // So console.error is the only signal that survives — capture it.
    const swallowed = [];
    ctx.console = Object.assign(Object.create(console), {
        error(...args) {
            const first = args[0];
            swallowed.push({
                message: (first && first.message) ? first.message : String(first),
                stack:   (first && first.stack)   ? String(first.stack).split('\n').slice(0, 3).join('\n') : null,
            });
        },
    });

    // Forward host globals the game relies on into the vm context.
    ctx.URLSearchParams   = URLSearchParams;
    ctx.URL               = URL;
    ctx.TextEncoder       = TextEncoder;
    ctx.Uint8Array        = Uint8Array;
    ctx.Uint8ClampedArray = Uint8ClampedArray;
    ctx.Float32Array      = Float32Array;
    ctx.ArrayBuffer       = ArrayBuffer;
    ctx.Proxy             = Proxy;

    ctx.location = {
        search,
        href: 'http://localhost:8000/' + search,
        hash: '', pathname: '/', reload() {},
    };

    ctx.navigator = {
        userAgent: 'node-golden-trace',
        getGamepads() { return gamepadState.connected ? [gamepadState] : [null]; },
    };

    // Fixed clock. The stub drives time via getDeltaTime(); nothing may read a
    // real clock or traces stop being reproducible.
    ctx.performance = { now: () => 0 };
    ctx.Date = new Proxy(Date, { construct: () => new Date(0) });

    // Seeded settings. game.js gates real behaviour on these via _lsGet():
    //   setting_gamepad    '1' → pollGamepad() runs at all (game.js:3247)
    //   setting_rightspin  '1' → inverts spin direction
    //   setting_mirrorkeys '1' → swaps ArrowLeft/ArrowRight
    const lsInit = new Map(Object.entries(opts.localStorage || {})
        .map(([k, v]) => [k, String(v)]));
    ctx.localStorage = {
        _d: lsInit,
        getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
        setItem(k, v) { this._d.set(k, String(v)); },
        removeItem(k) { this._d.delete(k); },
        clear() { this._d.clear(); },
    };

    ctx.addEventListener = (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
    };
    ctx.removeEventListener = (type, fn) => {
        const l = listeners.get(type);
        if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
    };
    // Real dispatch, not a stub: tests/test.html drives input with
    // `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' }))`,
    // so both the constructor and a working dispatchEvent are required or those
    // integration tests silently cannot exercise the game at all.
    ctx.Event = class Event {
        constructor(type, init = {}) {
            this.type = type;
            this.bubbles = !!init.bubbles;
            this.cancelable = !!init.cancelable;
            this.defaultPrevented = false;
        }
        preventDefault() { this.defaultPrevented = true; }
        stopPropagation() {}
    };
    ctx.KeyboardEvent = class KeyboardEvent extends ctx.Event {
        constructor(type, init = {}) {
            super(type, init);
            this.code     = init.code || '';
            this.key      = init.key !== undefined ? init.key : (init.code || '');
            this.repeat   = !!init.repeat;
            this.altKey   = !!init.altKey;
            this.ctrlKey  = !!init.ctrlKey;
            this.shiftKey = !!init.shiftKey;
            this.metaKey  = !!init.metaKey;
        }
    };
    ctx.dispatchEvent = (ev) => {
        if (!ev || !ev.type) return true;
        for (const fn of (listeners.get(ev.type) || []).slice()) fn(ev);
        return !ev.defaultPrevented;
    };

    const body = makeElement('body');
    ctx.document = {
        body,
        documentElement: makeElement('html'),
        getElementById: () => makeElement(),
        querySelector: () => makeElement(),
        querySelectorAll: () => [],
        createElement: (t) => makeElement(t),
        addEventListener: (type, fn) => ctx.addEventListener(type, fn),
        removeEventListener: (type, fn) => ctx.removeEventListener(type, fn),
        exitPointerLock() {}, exitFullscreen() {},
        hidden: false, pointerLockElement: null, fullscreenElement: null,
    };

    // ── Virtual timers ──────────────────────────────────────────────────────
    // Real timers would break determinism, but no-op timers are equally wrong:
    // the twist system arms `secondKeyTimer = setTimeout(enterDoubleMode,
    // DOUBLE_HOLD_MS)` (game.js:2785), so with no-op timers double-twist mode can
    // NEVER fire and that whole gameplay path is untestable.
    //
    // Instead: a queue on a virtual clock advanced 16.667 ms per rendered frame,
    // matching the stub's fixed getDeltaTime(). Fully deterministic, and
    // timer-driven behaviour actually happens.
    const timers = [];
    let timerSeq = 0;
    let virtualNow = 0;

    ctx.setTimeout = (fn, ms = 0) => {
        const id = ++timerSeq;
        timers.push({ id, at: virtualNow + Math.max(0, ms || 0), fn });
        return id;
    };
    ctx.clearTimeout = (id) => {
        const i = timers.findIndex(t => t.id === id);
        if (i >= 0) timers.splice(i, 1);
    };
    ctx.setInterval           = () => 0;   // nothing in game.js relies on these
    ctx.clearInterval         = () => {};
    ctx.requestAnimationFrame = () => 0;
    ctx.cancelAnimationFrame  = () => {};
    ctx.alert                 = () => {};
    ctx.Audio                 = function () { return makeElement('audio'); };

    vm.createContext(ctx);

    // Determinism: the crash ragdoll (game.js:4069+) calls Math.random() ~9 times
    // per body part for tumble velocities and spin rates. Left alone, every crash
    // trace would differ run to run and be useless as a golden master. Replace
    // Math.random inside the context with a seeded PRNG — everything else on Math
    // is left untouched.
    //
    // Done AFTER createContext so we patch the context's own Math, not the host's.
    const rng = mulberry32(seed);
    ctx.__seededRandom__ = rng;
    vm.runInContext('Math.random = __seededRandom__; delete globalThis.__seededRandom__;', ctx);

    return {
        ctx,
        seed,
        gamepadState,

        /** Exceptions game.js swallowed into console.error. Empty = clean run. */
        swallowedErrors: swallowed,
        takeSwallowedErrors() { return swallowed.splice(0, swallowed.length); },

        /** Run a script file inside the context, exactly as a <script> tag would. */
        load(file) {
            const code = fs.readFileSync(file, 'utf8');
            vm.runInContext(code, ctx, { filename: path.basename(file) });
        },

        /**
         * Advance the virtual clock and fire any timers now due. Called once per
         * rendered frame by the harness, so timer callbacks land at deterministic
         * frame boundaries.
         */
        advanceTimers(ms) {
            virtualNow += ms;
            // Re-check each pass: a callback may schedule another timer.
            for (let guard = 0; guard < 1000; guard++) {
                const due = timers.filter(t => t.at <= virtualNow);
                if (!due.length) break;
                for (const t of due) {
                    const i = timers.indexOf(t);
                    if (i >= 0) timers.splice(i, 1);
                    try { t.fn(); } catch (e) { /* mirrors browser timer isolation */ }
                }
            }
        },

        /**
         * Fire an arbitrary event type at every registered listener.
         * Used to raise DOMContentLoaded, which tests/test.html wraps its
         * integration sections in.
         */
        fire(type, ev = {}) {
            const e = { type, target: ctx.document, preventDefault() {}, stopPropagation() {}, ...ev };
            for (const fn of (listeners.get(type) || []).slice()) fn(e);
        },

        /** Fire a synthetic keyboard event at every registered window listener. */
        key(type, code, extra = {}) {
            const ev = {
                type,
                code,
                key: extra.key || code,
                repeat: false,
                preventDefault() {}, stopPropagation() {},
                ...extra,
            };
            for (const fn of (listeners.get(type) || []).slice()) fn(ev);
        },
    };
}

module.exports = { createEnv, makeElement };
