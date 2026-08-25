'use strict';
// ── Run tests/test.html headlessly ───────────────────────────────────────────
//
//   node tests/browser-suite.js
//
// tests/test.html is the existing browser integration suite (~58 assertions).
// It could only be run by opening a browser, which is impossible on this
// headless machine — so the "all tests green before merge" rule could not
// actually be checked here.
//
// It needs no browser in practice: its assertions only use a tiny hand-rolled
// framework (section/test/assert/assertClose/...) plus the Babylon stub, and it
// touches the DOM only in renderResults(). So we boot the SAME vm context the
// golden-trace harness uses, inject the framework, execute the suite's inline
// <script>, and read the results out of the context.
//
// NO new dependencies. The test source stays in test.html — this file does not
// duplicate assertions, so the browser and headless runs cannot drift apart.
//
// Caveat worth knowing: this runs against tests/babylon-stub.js, not real
// Babylon. It cannot catch places where the stub diverges from the real engine.
// See docs/FINDINGS.md NOTE-003 for why that matters.

const fs   = require('node:fs');
const path = require('node:path');
const vm   = require('node:vm');
const { createEnv } = require('./golden/browser-env');
const { extendStub } = require('./golden/stub-extend');
const { ENGINE_MODULES } = require('./golden/harness');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'tests', 'test.html');

/** Pull the inline suite out of test.html — the last <script> with no src. */
function extractSuite(html) {
    const blocks = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) blocks.push(m[1]);
    if (!blocks.length) throw new Error('no inline <script> found in test.html');
    return blocks.join('\n;\n');
}

function main() {
    const env = createEnv({ search: '', seed: 1 });
    env.load(path.join(ROOT, 'tests', 'babylon-stub.js'));
    extendStub(env.ctx);
    // Same engine modules, same order, as index.html and tests/test.html.
    for (const mod of ENGINE_MODULES) env.load(path.join(ROOT, mod));
    env.load(path.join(ROOT, 'game.js'));

    const ctx = env.ctx;

    // renderResults() writes into the page; make it inert. Everything else in
    // the suite's framework is pure and runs unchanged.
    ctx.renderResults = () => {};

    const suite = extractSuite(fs.readFileSync(HTML, 'utf8'));
    try {
        vm.runInContext(suite, ctx, { filename: 'test.html<inline>' });
    } catch (e) {
        console.error('suite threw while executing:', e && e.stack || e);
        process.exit(1);
    }

    // Sections C and D are wrapped in a DOMContentLoaded listener. game.js boots
    // through its own `else` branch (our document has no readyState, so it is not
    // 'loading'), which means game.js never registered a listener — firing this
    // reaches only the suite's sections and cannot double-initialise the game.
    env.fire('DOMContentLoaded');

    // `const _sections` in the suite is a lexical global, NOT a property of the
    // context object, so ctx._sections is undefined. Evaluating the identifier
    // inside the same context does reach it.
    const sections = vm.runInContext('typeof _sections !== "undefined" ? _sections : null', ctx);
    if (!Array.isArray(sections) || !sections.length) {
        console.error('no results captured — did test.html change its framework?');
        process.exit(1);
    }

    let pass = 0, fail = 0, skipped = 0;
    for (const s of sections) {
        const bad = s.tests.filter(t => !t.ok && !t.skipped);
        console.log(`\n${s.title}`);
        for (const t of s.tests) {
            if (t.skipped) { skipped++; console.log(`  skip  ${t.name}`); continue; }
            if (t.ok)      { pass++;    console.log(`  ok    ${t.name}`); continue; }
            fail++;
            console.log(`  FAIL  ${t.name}`);
            console.log(`        ${t.err}`);
        }
        void bad;
    }

    console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped ` +
                `(${sections.length} sections)`);
    if (fail) {
        console.log('\nBrowser integration suite is RED — do not merge.');
        process.exit(1);
    }
}

main();
