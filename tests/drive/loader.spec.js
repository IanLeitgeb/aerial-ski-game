'use strict';
// ── glTF loader availability ─────────────────────────────────────────────────
// lib/babylon.js is Babylon CORE only — it does NOT include the glTF/GLB format
// plugin. SceneLoader and ImportMesh exist in core, so calls to them look
// plausible and then fail at runtime with "Unable to find a plugin to load .glb".
//
// That gap meant no Blender-authored asset could load at all. This asserts the
// loader is present and actually registered with SceneLoader, in the real
// browser — the only place that can be verified.

const { test, expect } = require('@playwright/test');

test('the glTF loader is registered and can handle .glb', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });

    const info = await page.evaluate(() => {
        const out = {
            hasSceneLoader: typeof BABYLON.SceneLoader === 'function' ||
                            typeof BABYLON.SceneLoader === 'object',
            hasGLTFFileLoader: typeof BABYLON.GLTFFileLoader === 'function',
            registered: [],
        };
        // Use the PUBLIC API rather than poking at internals — an internal
        // field name is a guess, and guessing produced a false failure here.
        try {
            out.glb  = BABYLON.SceneLoader.IsPluginForExtensionAvailable('.glb');
            out.gltf = BABYLON.SceneLoader.IsPluginForExtensionAvailable('.gltf');
        } catch (e) { out.registerError = String(e); }
        return out;
    });

    expect(info.hasSceneLoader, 'SceneLoader missing from core').toBe(true);
    expect(info.hasGLTFFileLoader,
        'GLTFFileLoader not present — lib/babylonjs.loaders.min.js did not load. ' +
        'Babylon core does NOT include the glTF plugin.').toBe(true);

    // The plugin must be REGISTERED for these extensions, not merely loaded —
    // a loaded-but-unregistered plugin still fails with "Unable to find a plugin".
    expect(info.registerError, 'IsPluginForExtensionAvailable threw').toBeUndefined();
    expect(info.glb,  '.glb has no registered loader plugin').toBe(true);
    expect(info.gltf, '.gltf has no registered loader plugin').toBe(true);

    expect(errors, 'page errors after adding the loader').toEqual([]);
});
