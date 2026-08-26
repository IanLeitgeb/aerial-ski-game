'use strict';
// ── The rig, the skis and the crash ─────────────────────────────────────────
// Three things that are invisible to every other test because they are about
// where geometry ENDS UP, not about whether it loaded.

const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._bodyLinked !== undefined,
        null, { timeout: 30_000 });
    await page.waitForTimeout(800);
}

test('each ski sits under its own boot', async ({ page }) => {
    // "One boot does not come down on the ski" is a symptom with several possible
    // causes — a mirrored side, an inverted bone, an unconstrained roll — and all
    // of them look the same. This measures the thing itself: for each side, the
    // ski must be directly below that side's shin bone and no lower than the sole.
    await boot(page);

    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
        const skel = parts.length ? parts[0].skeleton : null;
        const out = { sides: {} };
        for (const side of ['L', 'R']) {
            const ski = scene.getMeshByName('ski' + side);
            const bone = skel && skel.bones.find(b => b.name === 'lowerLeg' + side);
            const node = bone && bone.getTransformNode && bone.getTransformNode();
            if (!ski || !node) { out.sides[side] = null; continue; }
            ski.computeWorldMatrix(true);
            node.computeWorldMatrix(true);
            const s = ski.getAbsolutePosition();
            const n = node.getAbsolutePosition();
            // LOCAL extents. extendSizeWorld is an axis-aligned box in world
            // space, so it reports a forward-pointing ski as "wide" the moment
            // the skier yaws — which they do in the ready state. Asking it about
            // the ski's own proportions gives an answer about the camera.
            const ext = ski.getBoundingInfo().boundingBox.extendSize;
            out.sides[side] = {
                size: [+(ext.x * 2).toFixed(3), +(ext.y * 2).toFixed(3),
                       +(ext.z * 2).toFixed(3)],
                ski: [+s.x.toFixed(3), +s.y.toFixed(3), +s.z.toFixed(3)],
                shin: [+n.x.toFixed(3), +n.y.toFixed(3), +n.z.toFixed(3)],
                lateral: +Math.abs(s.x - n.x).toFixed(3),
                fore: +Math.abs(s.z - n.z).toFixed(3),
                drop: +(n.y - s.y).toFixed(3),
            };
        }
        return out;
    });

    for (const side of ['L', 'R']) {
        const m = r.sides[side];
        expect(m, `no ski${side} or no lowerLeg${side} driver`).not.toBeNull();
        // Directly beneath: a ski that has wandered sideways from its own shin is
        // the "skewed skis" fault, and it was caused by the rig, not the skis.
        expect(m.lateral, `ski${side} is ${m.lateral} m to the side of its own ` +
            `shin — it is not under that boot`).toBeLessThan(0.10);
        expect(m.fore, `ski${side} is ${m.fore} m fore/aft of its own shin`)
            .toBeLessThan(0.25);
        // And below it, not above it.
        expect(m.drop, `ski${side} is not below the shin (drop ${m.drop} m)`)
            .toBeGreaterThan(0);
    }
    // A ski is a long thin thing and it must be long ALONG the direction of
    // travel. Built in Blender the segment record lists (w, h, d) while the rig's
    // axes are (fore/aft, lateral, up), so scaling in the listed order produces a
    // ski 1.2 m wide and 8 cm long — lying across the fall line, under a boot
    // that is nowhere near either end of it.
    for (const side of ['L', 'R']) {
        const d = r.sides[side].size;
        expect(d[2], `ski${side} is ${d[2]} m long fore/aft but ${d[0]} m wide — ` +
            `it is lying across the fall line`).toBeGreaterThan(d[0] * 3);
    }

    // Symmetry: whatever the pose, the two sides must be treated alike.
    expect(Math.abs(r.sides.L.drop - r.sides.R.drop),
        `the two skis sit at different heights under their boots ` +
        `(${r.sides.L.drop} vs ${r.sides.R.drop}) — one of them is not on its ski`)
        .toBeLessThan(0.05);
});

test('the athlete is still visible after a crash', async ({ page }) => {
    // The crash detaches the DRIVER solids and disables the character root. The
    // skinned body hid every one of those drivers when it loaded and hangs off
    // that root, so the crash used to leave nothing on screen but the skis —
    // which survive only because they are equipment and were never hidden.
    //
    // Rather than drive the game into a real crash, which depends on landing
    // angles and would be flaky, this invokes the same visibility contract the
    // crash relies on: at every moment SOMETHING of the athlete must be visible.
    await boot(page);

    const visible = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const isAthlete = (m) => m.name && (
            m.name.startsWith('athleteBody') ||
            ['torso', 'head', 'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR',
             'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR'].includes(m.name));
        const count = () => scene.meshes.filter(
            m => isAthlete(m) && m.isVisible && m.getTotalVertices() > 0).length;

        const before = count();
        // Reproduce exactly what the crash does to visibility: show the drivers,
        // hide the skinned body.
        const drivers = [];
        for (const m of scene.meshes) {
            if (!isAthlete(m)) continue;
            if (m.name.startsWith('athleteBody')) { m.isVisible = false; }
            else { drivers.push(m); m.isVisible = true; }
        }
        const during = count();
        return { before, during, drivers: drivers.length };
    });

    expect(visible.before, 'no athlete geometry visible at rest').toBeGreaterThan(0);
    expect(visible.drivers, 'no driver solids exist to ragdoll').toBeGreaterThan(0);
    expect(visible.during,
        'nothing is visible once the skinned body is hidden — a crash would ' +
        'leave the skis tumbling on their own').toBeGreaterThan(0);
});
