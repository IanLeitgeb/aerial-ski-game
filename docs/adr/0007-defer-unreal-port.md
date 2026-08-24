# ADR-0007: Defer the Unreal Engine port trial

## Status
Accepted — 2026-08-24

## Context
An Unreal port was investigated as a route to photorealism. Findings:

- **`buypower` is headless.** No display server, `systemctl get-default` is
  `multi-user.target`, `nvidia-smi` reports `display_active: Disabled`. The
  Unreal Editor is a Vulkan GUI application and cannot run there.
- **It is a shared team server.** Active sessions for `justin` (uid 1000, the
  primary owner), `scastellanos` and `xgrab`; load average 3.4–5.9 on 16 cores.
  A ~60 GB install and sustained 16-core compiles are not a unilateral decision.
- **30 GB RAM.** Epic's Linux guidance sets 32 GB as the floor for a source
  build; a prebuilt binary would be mandatory.
- Unreal has **no web export** (dropped after UE 4.24), so browser delivery would
  require Pixel Streaming — a GPU server per concurrent player, replacing today's
  effectively-free static hosting, and adding input latency to a timing-critical game.

Separately, the perceived need was partly misdiagnosed: the current renderer uses
`StandardMaterial` everywhere (0 `PBRMaterial`), has no environment map, and runs
with the HDR framebuffer disabled — so Babylon's capability was largely unused.

## Decision
Defer the Unreal port. Pursue photorealism within Babylon via PBR materials, IBL,
and Blender-authored assets with baked GI (see ADR-0008).

This is **deferral, not rejection**. ADR-0005's golden traces and ADR-0002's
engine/render split are exactly the groundwork that would make a future port
cheap, and both are being built now.

## Consequences
- Browser distribution is retained: a URL, free scaling, no per-player cost.
- Accepts a real ceiling — no real-time global illumination. Baked GI mitigates
  this for static geometry but not for dynamic objects.
- Revisit if photorealism demands real-time GI, ray-traced reflections, or
  volumetrics that baking cannot deliver.
