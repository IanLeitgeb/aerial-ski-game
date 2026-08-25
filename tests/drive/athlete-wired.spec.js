'use strict';
// ── The Blender athlete is actually IN the running game ──────────────────────
// athlete.spec.js proves the .glb loads. This proves the game USES it — a
// distinction that matters, because the transplant is asynchronous and failing
// silently leaves the primitive athlete in place, which looks like "the change
// did nothing" rather than like an error.

const { test, expect } = require('@playwright/test');

const SEGMENTS = [
    'torso', 'head',
    'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR',
    'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR',
    'skiL', 'skiR',
];

async function bootAndUpgrade(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    // The transplant resolves off a promise; wait for its completion flag.
    await page.waitForFunction(() => window._athleteGeometryUpgraded !== undefined,
        null, { timeout: 30_000 });
}

test('the running athlete uses the Blender geometry', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

    await bootAndUpgrade(page);

    const info = await page.evaluate(() => {
        const cm = window._characterMeshes || {};
        const out = { upgraded: window._athleteGeometryUpgraded, verts: {} };
        for (const [k, v] of Object.entries(cm)) {
            const m = (v && v.mesh) ? v.mesh : v;
            out.verts[k] = (m && m.getTotalVertices) ? m.getTotalVertices() : 0;
        }
        return out;
    });

    expect(info.upgraded, 'geometry transplant reported zero segments swapped')
        .toBeGreaterThan(0);
    expect(info.upgraded, 'not every body segment got the Blender geometry')
        .toBeGreaterThanOrEqual(SEGMENTS.length);

    // The primitive skis were plain boxes: 24 vertices. Bevelled Blender skis are
    // far denser, so this distinguishes "upgraded" from "still the primitive".
    expect(info.verts.skiL, 'skiL still looks like the primitive box')
        .toBeGreaterThan(100);
    expect(info.verts.head, 'head is not the Blender helmet').toBeGreaterThan(400);

    expect(errors, 'errors during the geometry transplant').toEqual([]);
});

test('the donor meshes and skeleton are cleaned up', async ({ page }) => {
    await bootAndUpgrade(page);

    const leftovers = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        return {
            // The loaded glb root is named __root__ by the glTF loader.
            donorRoots: scene.meshes.filter(m => m.name === '__root__').length,
            skeletons: scene.skeletons.length,
            // Segment names must appear exactly ONCE — a leftover donor would
            // render a second athlete at the origin.
            duplicateTorso: scene.meshes.filter(m => m.name === 'torso').length,
            duplicateHead: scene.meshes.filter(m => m.name === 'head').length,
        };
    });

    expect(leftovers.donorRoots, 'the glb root was not disposed — a second athlete is in the scene').toBe(0);
    expect(leftovers.skeletons, 'the donor skeleton was left behind').toBe(0);
    expect(leftovers.duplicateTorso, 'more than one torso in the scene').toBe(1);
    expect(leftovers.duplicateHead, 'more than one head in the scene').toBe(1);
});

test('the pose solver still drives the transplanted geometry', async ({ page }) => {
    // Geometry swapped in place must leave the pose solver driving it exactly as
    // before. If the transplant broke parenting or mesh identity, the body would
    // freeze while everything else kept running.
    //
    // The arm's LOCAL transform is deliberately NOT probed on the approach: it is
    // static while the athlete is grounded, so an earlier version of this test
    // reported failure against a perfectly working game. Tuck while airborne is
    // the right signal — computePose blends the whole body and visibly moves the
    // limbs.
    await bootAndUpgrade(page);

    await page.keyboard.press('ArrowUp');
    await page.keyboard.down('ArrowDown');
    await page.waitForFunction(() => window._getGameState().flipPower >= 0.6,
        null, { timeout: 60_000 });
    await page.keyboard.up('ArrowDown');
    await page.waitForFunction(() => window._getGameState().grounded === false,
        null, { timeout: 90_000 });

    const moved = await page.evaluate(async () => {
        const cm = window._characterMeshes;
        const arm = () => {
            const a = cm.upperArmL, m = (a && a.mesh) ? a.mesh : a;
            return m ? [m.position.y, m.position.z, m.rotation.x] : null;
        };
        const before = arm();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        await new Promise(r => setTimeout(r, 1200));
        const after = arm();
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
        if (!before || !after) return { ok: false, reason: 'no upperArmL' };
        return { ok: before.some((v, i) => Math.abs(v - after[i]) > 1e-6), before, after };
    });

    expect(moved.ok,
        `pose solver is not moving the transplanted mesh: ${JSON.stringify(moved)}`).toBe(true);
});
