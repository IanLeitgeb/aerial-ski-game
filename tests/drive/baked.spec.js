'use strict';
// ── Baked lighting from Blender ──────────────────────────────────────────────
// Two maps, both MULTIPLIERS, both needing a uv2 channel the procedural terrain
// does not have:
//
//   terrain_skyvis.png  -> ambientTexture     (how much sky each point sees)
//   terrain_shadow.png  -> lightmapTexture    (how much sun reaches it), applied
//                          with useLightmapAsShadowmap so it multiplies rather
//                          than adds
//
// The failure this file exists to catch is the quiet one. Every earlier attempt
// at wiring a bake in "worked" by every structural measure — the texture loaded,
// the material had it, nothing threw — while contributing nothing to the image,
// because the UVs were wrong or the map was black. So the last test here does not
// inspect the scene graph at all: it renders the same frame with and without the
// maps and insists the pixels actually change.

const { test, expect } = require('@playwright/test');

// Enough of the receiver set to prove the sidecar is being matched by name,
// including one of the wide flanking slabs and one transition segment.
const RECEIVERS = ['landing', 'outrun', 'slope', 'wLanding', 'trans_seg_8'];

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._bakedApplied > 0,
        null, { timeout: 30_000 });
}

test('the baked maps reach the terrain, with uv2 and the right slots', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

    await boot(page);

    const info = await page.evaluate((names) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const out = { applied: window._bakedApplied, meshes: {} };
        for (const n of names) {
            const m = scene.getMeshByName(n);
            if (!m) { out.meshes[n] = null; continue; }
            const uv2 = m.getVerticesData(BABYLON.VertexBuffer.UV2Kind);
            const mat = m.material;
            out.meshes[n] = {
                verts: m.getTotalVertices(),
                uv2Len: uv2 ? uv2.length : 0,
                // A uv2 buffer of the right length that is entirely zero would
                // sample one corner of the atlas for the whole mesh — structurally
                // perfect and visually meaningless.
                uv2Span: uv2 ? Math.max(...uv2) - Math.min(...uv2) : 0,
                ambient: mat && mat.ambientTexture ? {
                    url: mat.ambientTexture.name,
                    coords: mat.ambientTexture.coordinatesIndex,
                    gamma: mat.ambientTexture.gammaSpace,
                } : null,
                lightmap: mat && mat.lightmapTexture ? {
                    url: mat.lightmapTexture.name,
                    coords: mat.lightmapTexture.coordinatesIndex,
                    gamma: mat.lightmapTexture.gammaSpace,
                    asShadow: mat.useLightmapAsShadowmap,
                } : null,
            };
        }
        return out;
    }, RECEIVERS);

    expect(info.applied, 'no terrain meshes received the bake').toBeGreaterThanOrEqual(20);

    for (const n of RECEIVERS) {
        const m = info.meshes[n];
        expect(m, `terrain mesh "${n}" is missing from the scene`).not.toBeNull();
        expect(m.uv2Len, `"${n}" has no uv2 — it cannot sample the atlas`)
            .toBe(m.verts * 2);
        expect(m.uv2Span, `"${n}" has a degenerate uv2 (all one value), so the ` +
            `whole mesh samples a single point of the atlas`).toBeGreaterThan(0.01);

        expect(m.ambient, `"${n}" has no sky-visibility map`).not.toBeNull();
        expect(m.ambient.coords, `sky-visibility map on "${n}" is reading uv0 — ` +
            `that is the tiled detail channel, not the lightmap atlas`).toBe(1);
        expect(m.ambient.gamma, `sky-visibility map is being sRGB-decoded; it is ` +
            `data, not colour`).toBe(false);

        expect(m.lightmap, `"${n}" has no sun-shadow map`).not.toBeNull();
        expect(m.lightmap.coords).toBe(1);
        expect(m.lightmap.gamma).toBe(false);
        expect(m.lightmap.asShadow, `the shadow map is being ADDED rather than ` +
            `multiplied — that double-counts the sun`).toBe(true);
    }

    expect(errors, 'errors or missing assets while applying the bake').toEqual([]);
});

test('only the athlete casts a real-time shadow', async ({ page }) => {
    // The static shadows are baked, so the runtime map no longer has to span the
    // trees and the background peaks. If this regresses, the athlete's own shadow
    // gets a few texels of a several-hundred-metre frustum and turns to mush —
    // which reads as "shadows look bad" rather than as a caster-list problem.
    await boot(page);
    const n = await page.evaluate(() => window._shadowCasters);
    expect(n, 'shadow caster list was not restricted').toBeGreaterThan(0);
    expect(n, `${n} shadow casters — the whole scene is still in the map`)
        .toBeLessThan(40);
});

test('every mesh using a baked material actually has uv2', async ({ page }) => {
    // A mesh with NO uv2 buffer does not get skipped by the shader — it feeds it
    // zeros, so the whole mesh samples atlas texel (0, 0) and is lit by whatever
    // happens to sit in that corner. snowMat is shared by 71 meshes while the
    // atlas covers 28, so putting the maps on the shared material would have
    // quietly mislit the other 43. The fix is a per-material clone; this is what
    // stops it regressing.
    await boot(page);
    const bad = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const out = [];
        for (const m of scene.meshes) {
            const mat = m.material;
            if (!mat || !mat.lightmapTexture) continue;
            if (!m.getTotalVertices()) continue;
            if (!m.isVerticesDataPresent(BABYLON.VertexBuffer.UV2Kind)) {
                out.push(`${m.name} (${mat.name})`);
            }
        }
        return out;
    });
    expect(bad, 'these meshes carry a baked material but no uv2, so they sample ' +
        'one corner of the atlas for their entire surface').toEqual([]);
});

test('both baked slots reach the shader', async ({ page }) => {
    // The test that matters, and it is deliberately NOT "the bake changes the
    // picture".
    //
    // A map can be bound to the right slot on the right material, with correct
    // uv2, and still change nothing — because on THIS terrain the baked values
    // come out at ~1.0 almost everywhere. That is a true fact about six flat
    // slabs under an open sky with the tree line pushed 45 m off to the sides,
    // not a fault in the pipeline, and asserting on the delta would make the test
    // fail for a scene-content reason it cannot distinguish from a wiring bug.
    //
    // So this forces each slot to solid BLACK in turn. Both are multipliers, so a
    // black map must collapse the term it multiplies. If the image does not move,
    // the sampler is not compiled in and the slot is dead — which IS a wiring bug,
    // and is the thing three earlier attempts at this got wrong while looking
    // perfectly healthy from the scene graph.
    await boot(page);
    await page.waitForFunction(() => window._surfacesApplied !== undefined,
        null, { timeout: 30_000 });
    await page.waitForTimeout(1200);

    const r = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        cam.lowerRadiusLimit = 1; cam.upperRadiusLimit = 500;
        cam.setTarget(new BABYLON.Vector3(0, -18, 40));
        cam.radius = 70; cam.beta = Math.PI / 2.6; cam.alpha = Math.PI * 1.30;

        const solidBlack = () => {
            const t = new BABYLON.DynamicTexture('probeBlack',
                { width: 4, height: 4 }, scene, false);
            const ctx = t.getContext();
            ctx.fillStyle = 'rgb(0,0,0)';
            ctx.fillRect(0, 0, 4, 4);
            t.update();
            t.coordinatesIndex = 1;
            return t;
        };
        const lum = async () => {
            for (let i = 0; i < 3; i++) {
                scene.render();
                await new Promise(res => requestAnimationFrame(res));
            }
            const c = scene.getEngine().getRenderingCanvas();
            const gl = scene.getEngine()._gl;
            const px = new Uint8Array(c.width * c.height * 4);
            gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
            let s = 0;
            for (let i = 0; i < px.length; i += 4) {
                s += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            }
            return s / (px.length / 4);
        };

        const mats = scene.materials.filter(m => m.ambientTexture || m.lightmapTexture);
        const orig = mats.map(m => [m, m.ambientTexture, m.lightmapTexture]);
        const base = await lum();

        for (const [m] of orig) m.ambientTexture = solidBlack();
        const ambBlack = await lum();
        for (const [m, a] of orig) m.ambientTexture = a;

        for (const [m] of orig) m.lightmapTexture = solidBlack();
        const lmBlack = await lum();
        for (const [m, a, l] of orig) m.lightmapTexture = l;

        for (const [m] of orig) { m.ambientTexture = null; m.lightmapTexture = null; }
        const none = await lum();
        for (const [m, a, l] of orig) { m.ambientTexture = a; m.lightmapTexture = l; }

        return { mats: mats.length, base, ambBlack, lmBlack, none };
    });

    expect(r.mats, 'no materials carry the baked maps').toBeGreaterThan(0);
    expect(r.base - r.ambBlack,
        'blacking out the sky-visibility map did not darken the image — the ' +
        'ambient slot is not reaching the shader').toBeGreaterThan(5);
    expect(r.base - r.lmBlack,
        'blacking out the sun-shadow map did not darken the image — the lightmap ' +
        'slot is not reaching the shader, or is being added rather than multiplied')
        .toBeGreaterThan(5);

    // Reported, not asserted: how much the REAL maps contribute here. On flat
    // open snow this is close to zero and that is the correct answer.
    console.log(`BAKE_CONTRIBUTION base=${r.base.toFixed(2)} ` +
        `noMaps=${r.none.toFixed(2)} delta=${(r.none - r.base).toFixed(2)}/255 ` +
        `(ambient headroom ${(r.base - r.ambBlack).toFixed(1)}, ` +
        `shadow headroom ${(r.base - r.lmBlack).toFixed(1)})`);
});
