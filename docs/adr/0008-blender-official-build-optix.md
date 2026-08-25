# ADR-0008: Blender official build with OptiX for GPU baking

## Status
Accepted — 2026-08-24

## Context
The renderer's realism gap is largely missing *assets*, not missing engine
capability. Measured: **0 `diffuseTexture`, 0 `bumpTexture`, 0 `emissiveTexture`**
— every surface is a flat solid colour — plus 0 `PBRMaterial` and no
`scene.environmentTexture`.

Babylon (WebGL2) has no real-time global illumination. However the scene is
overwhelmingly static (`wUpperMtn`, `wInrun`, `wTable`, `wLanding`, `wOutrun`,
`slope`, `pk_body_`, `pk_cap_` …); only the athlete moves. Static geometry can
carry **baked** GI from an offline path tracer at zero runtime cost.

On packaging: the Debian/Ubuntu `blender` package (`5.0.1+dfsg`, 65 MB download,
79 packages) **cannot ship OptiX** — NVIDIA's licence forbids redistributing the
headers and Launchpad builds have no network access to fetch them. Installing it
would silently render Cycles on CPU only, wasting the RTX 5070 Ti.

## Decision
Use the **official blender.org binary tarball**, not the distro package.
It ships prebuilt CUDA and OptiX kernels, extracts to `$HOME`, and requires no
`sudo` — which also avoids imposing on a shared machine.

Render with **OptiX** (RT cores), verified at install:
```bash
blender -b --python-expr "import bpy;p=bpy.context.preferences.addons['cycles'].preferences;p.compute_device_type='OPTIX';p.get_devices();print([(d.name,d.type) for d in p.devices])"
```
OptiX requires driver ≥ 575; the host runs 595.71.05. ✅

Bakes run headless: `blender -b -P bake.py -- --cycles-device OPTIX`.

**Authored in Blender.** Athlete (dynamic): body mesh, race suit, helmet, goggle
lens/strap/foam, skis, bindings/boots, gloves, **armature**, plus baked normal and
AO maps. Environment (static): terrain, kicker, snow surface detail, sky HDRI,
plus baked **GI lightmaps** and AO.

**Critical distinction:** the environment receives baked GI lightmaps; the athlete
**never** does. Lightmaps encode light for a fixed position — an athlete that
somersaults and inverts would be lit catastrophically wrong. The athlete is lit at
runtime by the sun plus IBL.

First rendering pass is scoped to **aerial skiing only**; trampoline and diving
environment assets are deferred.

Prerequisite: `babylonjs.loaders.min.js` must be added to `lib/` — the glTF loader
is not in the current bundle, so no Blender export can load without it.

## Consequences
- Offline path-traced lighting quality at real-time cost, for static geometry.
- Headless GPU baking suits the machine well: no display needed, CPU left free.
- Baked lighting is fixed time-of-day; changing sun angle means re-baking.
- Blender procedural materials do not export to glTF and must be baked to images.
- Lightmaps need non-overlapping UVs on a second channel (`uv2`).
- Texture payload grows the 9.4 MB build; matters for page load, not for the GPU.
