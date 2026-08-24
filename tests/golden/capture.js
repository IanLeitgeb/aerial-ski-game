'use strict';
// Capture golden-master traces for every scenario into tests/golden/traces/.
//
//   node tests/golden/capture.js            capture all
//   node tests/golden/capture.js aerial     capture scenarios matching a substring
//
// Traces are the acceptance contract for the engine extraction (ADR-0005).
// Regenerating them is a deliberate act: it redefines "correct".

const fs   = require('node:fs');
const path = require('node:path');
const { scenarios }   = require('./scenarios');
const { runScenario } = require('./run-scenario');

const OUT = path.join(__dirname, 'traces');

function main() {
    const filter = process.argv[2];
    const list = filter ? scenarios.filter(s => s.name.includes(filter)) : scenarios;

    if (!list.length) {
        console.error('no scenarios match:', filter);
        process.exit(1);
    }

    fs.mkdirSync(OUT, { recursive: true });

    let failed = 0;
    for (const sc of list) {
        process.stdout.write(sc.name.padEnd(34));
        let trace;
        try {
            trace = runScenario(sc);
        } catch (e) {
            console.log('BOOT FAILED — ' + (e && e.message));
            failed++;
            continue;
        }

        const file = path.join(OUT, sc.name + '.json');
        fs.writeFileSync(file, JSON.stringify(trace));
        const kb = (fs.statSync(file).size / 1024).toFixed(0);

        const last = trace.frames[trace.frames.length - 1];
        const st   = last && last.state;
        const tag  = trace.error ? `ERROR@${trace.error.frame}: ${trace.error.message}` : 'ok';
        console.log(
            `${String(trace.frames.length).padStart(4)} keyframes  ${kb.padStart(5)} KB  ` +
            (st ? `posZ=${String(st.posZ).padStart(9)} crashed=${st.crashed ? 'Y' : 'n'} ` : '') +
            tag,
        );
        if (trace.error) failed++;
    }

    console.log(`\n${list.length - failed}/${list.length} scenarios captured cleanly.`);
    console.log('traces →', path.relative(process.cwd(), OUT));
    if (failed) process.exitCode = 1;
}

main();
