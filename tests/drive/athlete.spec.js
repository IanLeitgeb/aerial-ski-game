'use strict';
// ── Blender-authored athlete loads in real Babylon ───────────────────────────
// Proves the asset pipeline end to end BEFORE anything in game.js depends on it:
// Blender script -> .glb -> glTF loader -> a skeleton whose bone names match the
// physics segments exactly.
//
// That last point is the whole design. game.js already computes a transform per
// segment; if the bone names match, driving the rig is a direct mapping rather
// than a translation layer that could drift.

const { test, expect } = require('@playwright/test');

const SEGMENTS = [
    'torso', 'head',
    'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR',
    'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR',
    'skiL', 'skiR',
];

test('athlete.glb loads and its bones match the physics segments', async ({ page }) => {
    const failed = [];
    page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
    page.on('pageerror', e => failed.push(`pageerror: ${e.message}`));

    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });

    const result = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        try {
            const r = await BABYLON.SceneLoader.ImportMeshAsync(
                '', 'assets/', 'athlete.glb', scene);
            const skel = r.skeletons && r.skeletons[0];
            return {
                ok: true,
                meshCount: r.meshes.length,
                skeletons: (r.skeletons || []).length,
                boneNames: skel ? skel.bones.map(b => b.name) : [],
                totalVerts: r.meshes.reduce(
                    (n, m) => n + (m.getTotalVertices ? m.getTotalVertices() : 0), 0),
            };
        } catch (e) {
            return { ok: false, error: String(e && e.message || e) };
        }
    });

    expect(result.ok, `ImportMeshAsync threw: ${result.error}`).toBe(true);
    expect(result.skeletons, 'no skeleton in the glb — it exported unskinned').toBeGreaterThan(0);
    expect(result.totalVerts, 'no geometry loaded').toBeGreaterThan(1000);

    // Bone names ARE the interface. A rename in the Blender script would break
    // the mapping silently, so assert every physics segment has a bone.
    for (const seg of SEGMENTS) {
        expect(result.boneNames,
            `no bone named "${seg}" — game.js drives segments by this name`)
            .toContain(seg);
    }

    expect(failed, 'network or page errors while loading the athlete').toEqual([]);
});

test('the athlete has more geometry than the primitive version it replaces', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });

    const verts = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const r = await BABYLON.SceneLoader.ImportMeshAsync('', 'assets/', 'athlete.glb', scene);
        return r.meshes.reduce((n, m) => n + (m.getTotalVertices ? m.getTotalVertices() : 0), 0);
    });

    // Sanity floor, not an exact count — the mesh is expected to evolve. The
    // point is that it is real geometry, not a handful of boxes.
    expect(verts).toBeGreaterThan(3000);
});
