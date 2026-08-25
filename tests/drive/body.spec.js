'use strict';
// ── The continuous skinned body ──────────────────────────────────────────────
// The figure was always separate solids. This verifies the single skinned mesh
// loaded, that its bones are LINKED to the meshes the physics already drives,
// and that the solids it replaces are hidden rather than left overlapping it.
//
// The linking is the part worth testing hardest: if a bone is not linked, that
// limb simply stops following the simulation while everything else keeps moving,
// which is subtle enough to miss by eye.

const { test, expect } = require('@playwright/test');

const BODY_BONES = [
    'torso', 'head',
    'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR',
    'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR',
];

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._bodyLinked !== undefined,
        null, { timeout: 30_000 });
}

test('the continuous body loads and every bone is linked to its driver', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await boot(page);

    const info = await page.evaluate((bones) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const body = scene.meshes.find(m => m.name === 'athleteBody');
        const skel = body ? body.skeleton : null;
        return {
            linked: window._bodyLinked,
            hasBody: !!body,
            verts: body ? body.getTotalVertices() : 0,
            hasSkeleton: !!skel,
            boneNames: skel ? skel.bones.map(b => b.name) : [],
            linkedNames: skel
                ? skel.bones.filter(b => b.getTransformNode && b.getTransformNode()).map(b => b.name)
                : [],
            parent: body && body.parent ? body.parent.name : null,
        };
    }, BODY_BONES);

    expect(info.hasBody, 'athleteBody mesh not in the scene').toBe(true);
    expect(info.verts, 'body has no geometry').toBeGreaterThan(500);
    expect(info.hasSkeleton, 'body has no skeleton — it will not deform').toBe(true);
    expect(info.parent, 'body is not parented to the character root').toBe('skierRoot');

    for (const b of BODY_BONES) {
        expect(info.linkedNames,
            `bone "${b}" is not linked to a driver — that limb will stop following ` +
            `the simulation while the rest keeps moving`).toContain(b);
    }
    expect(info.linked).toBeGreaterThanOrEqual(BODY_BONES.length);
    expect(errors, 'errors while loading the body').toEqual([]);
});

test('the solids the body replaces are hidden, and the skis are not', async ({ page }) => {
    await boot(page);
    const vis = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const v = (n) => {
            const m = scene.meshes.find(x => x.name === n);
            return m ? m.isVisible : null;
        };
        return {
            torso: v('torso'), head: v('head'), upperArmL: v('upperArmL'),
            neck: v('neck'), visor: v('visor'),
            skiL: v('skiL'), skiR: v('skiR'),
            body: v('athleteBody'),
        };
    });

    // The drivers must still EXIST — they are the articulation — but not render,
    // or they would poke through the continuous body.
    expect(vis.torso, 'torso solid still visible — it will intersect the body').toBe(false);
    expect(vis.head, 'head solid still visible').toBe(false);
    expect(vis.upperArmL, 'arm solid still visible').toBe(false);
    expect(vis.neck, 'neck detail still visible').toBe(false);

    // Skis are equipment, not body: they stay.
    expect(vis.skiL, 'skis were hidden — they are equipment, not skin').toBe(true);
    expect(vis.skiR).toBe(true);
    expect(vis.body, 'the body itself is hidden').toBe(true);
});

test('the body deforms when the physics poses the athlete', async ({ page }) => {
    // The whole point of skinning: bone-driven deformation. If linkTransformNode
    // silently failed, the mesh would sit in its bind pose forever while the
    // invisible drivers moved underneath it.
    await boot(page);

    await page.keyboard.press('ArrowUp');
    await page.keyboard.down('ArrowDown');
    await page.waitForFunction(() => window._getGameState().flipPower >= 0.6,
        null, { timeout: 60_000 });
    await page.keyboard.up('ArrowDown');
    await page.waitForFunction(() => window._getGameState().grounded === false,
        null, { timeout: 90_000 });

    const moved = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const body = scene.meshes.find(m => m.name === 'athleteBody');
        const skel = body.skeleton;
        const read = () => skel.bones
            .filter(b => b.name === 'upperArmL' || b.name === 'lowerLegL')
            .map(b => {
                const m = b.getFinalMatrix ? b.getFinalMatrix() : b.getWorldMatrix();
                return m.m ? Array.from(m.m) : [];
            })
            .flat();
        const before = read();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        await new Promise(r => setTimeout(r, 1200));
        const after = read();
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
        const diff = before.reduce((n, v, i) => n + Math.abs(v - (after[i] || 0)), 0);
        return { ok: diff > 1e-4, diff };
    });

    expect(moved.ok,
        `bone matrices did not change when tucking — the body is stuck in its ` +
        `bind pose (diff=${moved.diff})`).toBe(true);
});
