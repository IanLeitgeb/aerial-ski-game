'use strict';
// ── Extraction fidelity guard ────────────────────────────────────────────────
// The per-module differential tests compare an extracted function against a
// HAND-COPY of the original pasted into the test file. That catches later drift
// in the module, but it CANNOT catch a transcription error made identically in
// both copies — the test would pass while the extraction was wrong.
//
// This test closes that hole by comparing each extracted function against the
// live source in game.js, so game.js remains the single source of truth until
// the extraction is complete and game.js is rewired to consume engine/.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const GAME = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');

/** Pull a top-level `function NAME(...) { ... }` out of source by brace matching. */
function extractFunction(src, name) {
    const start = src.search(new RegExp(`^function\\s+${name}\\s*\\(`, 'm'));
    assert.notStrictEqual(start, -1, `function ${name} not found in game.js`);
    let depth = 0, i = src.indexOf('{', start);
    const open = i;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
}

/** Strip comments and collapse whitespace so formatting differences don't fail. */
function normalise(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Functions that still exist in BOTH game.js and engine/, i.e. extracted but not
// yet wired in. Once a function is wired, game.js no longer defines it, there is
// only one copy, and this guard is retired for it — replaced by the
// "consumes the engine core" test below, which proves the deduplication.
const CASES = [
    // Empty: every extracted function is now WIRED, so game.js holds no
    // duplicate to compare against. Add an entry here only for a function that
    // has been extracted but not yet wired — that is the window in which two
    // copies exist and can drift.
];

for (const c of CASES) {
    test(`${c.name}: extracted module body matches game.js exactly`, () => {
        const modPath = path.join(ROOT, c.module);
        if (!fs.existsSync(modPath)) {
            assert.fail(`${c.module} does not exist — extraction not applied`);
        }
        const fromGame = normalise(extractFunction(GAME, c.name));
        const fromMod  = normalise(extractFunction(fs.readFileSync(modPath, 'utf8'), c.name));
        assert.strictEqual(fromMod, fromGame,
            `${c.name} in ${c.module} has drifted from game.js`);
    });
}

test('game.js consumes the engine core rather than duplicating it', () => {
    // The point of the extraction is deduplication, not just co-existence. For
    // each wired function, game.js must NOT define its own copy any more, and
    // must read it from the shared namespace.
    const WIRED = [
        { name: 'lerp',     namespace: 'AerialEngine.math' },
        { name: 'armSweep', namespace: 'AerialEngine.pose' },
        { name: 'computeI', namespace: 'AerialEngine.inertia' },
    ];

    for (const w of WIRED) {
        const ownDefinition = new RegExp(`^\\s*function\\s+${w.name}\\s*\\(`, 'm');
        assert.ok(!ownDefinition.test(GAME),
            `game.js still defines its own ${w.name}() — extraction left a duplicate, ` +
            `so the two copies can silently drift apart`);
        assert.ok(GAME.includes(w.namespace),
            `game.js does not reference ${w.namespace} — ${w.name} was removed but never wired`);
    }
});

test('engine module load order is consistent across all three entry points', () => {
    // index.html (browser), tests/test.html (browser suite) and the headless
    // harness each load engine modules separately. If those lists drift, the
    // browser and the tests run different code and the traces stop meaning
    // anything — so assert every module the harness loads is in both pages.
    const { ENGINE_MODULES } = require('../golden/harness');
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const testHtml  = fs.readFileSync(path.join(ROOT, 'tests', 'test.html'), 'utf8');

    for (const mod of ENGINE_MODULES) {
        assert.ok(indexHtml.includes(mod),
            `index.html does not load ${mod} — the game would break in a browser ` +
            `while every headless test still passes`);
        const asRelative = '../' + mod;
        assert.ok(testHtml.includes(asRelative) || testHtml.includes(mod),
            `tests/test.html does not load ${mod}`);
    }
});

test('every browser-loaded engine module is browser-safe', () => {
    // Only math.js was made dual-mode (CommonJS + global). Its siblings
    // (inertia.js, pose.js) are CommonJS-only and use bare `require`, which
    // throws `require is not defined` in a browser. Nothing stops someone
    // adding one to ENGINE_MODULES, and the load-order test above would still
    // pass because it only checks that the filename appears in the HTML.
    //
    // This asserts the actual property that matters: anything the browser loads
    // must not depend on a CommonJS environment at load time.
    // Behavioural, not a regex. A source scan cannot distinguish a fatal bare
    // `require(...)` from the legitimate guarded one inside the dual-mode
    // wrapper, and it flagged both. So actually EVALUATE each module in a
    // context that has no `require` and no `module` — exactly what a browser
    // provides — and assert it loads and registers itself.
    const vm = require('node:vm');
    const { ENGINE_MODULES } = require('../golden/harness');

    const browserish = { console };
    browserish.globalThis = browserish;
    browserish.window = browserish;
    vm.createContext(browserish);

    for (const mod of ENGINE_MODULES) {
        const src = fs.readFileSync(path.join(ROOT, mod), 'utf8');
        try {
            vm.runInContext(src, browserish, { filename: mod });
        } catch (e) {
            assert.fail(`${mod} throws when loaded as a browser <script>: ${e.message}\n` +
                `Give it the dual-mode wrapper that engine/core/math.js uses.`);
        }
    }

    assert.ok(browserish.AerialEngine,
        'no engine module registered an AerialEngine namespace in a browser context');

    // Every module must actually register something reachable.
    const registered = Object.keys(browserish.AerialEngine);
    assert.ok(registered.length >= ENGINE_MODULES.length,
        `${ENGINE_MODULES.length} modules loaded but only ${registered.length} ` +
        `namespaces registered (${registered.join(', ')}) — one is browser-loaded ` +
        `but unreachable from game.js`);
});

test('engine/ contains no renderer or DOM references (ADR-0002)', () => {
    const engineDir = path.join(ROOT, 'engine');
    if (!fs.existsSync(engineDir)) return;   // nothing extracted yet

    const offenders = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!e.name.endsWith('.js')) continue;
            const src = fs.readFileSync(p, 'utf8');
            for (const bad of ['BABYLON', 'document.', 'window.', 'localStorage', 'navigator.']) {
                if (src.includes(bad)) offenders.push(`${path.relative(ROOT, p)} → ${bad}`);
            }
        }
    })(engineDir);

    assert.deepStrictEqual(offenders, [],
        'engine/ must stay pure — game logic separated from display logic');
});
