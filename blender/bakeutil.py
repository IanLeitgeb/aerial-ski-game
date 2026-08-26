"""
Shared helpers for the bake scripts: PNG writing, encoding, and noise.

Kept out of bpy's image saver on purpose — see write_png.
"""

import math
import os
import struct
import zlib

import numpy as np


def write_png(path, rgb8, w, h):
    """
    Write an 8-bit RGB PNG without going through Blender's image saver.

    Saving through bpy applies whatever view transform and colour management the
    scene happens to have, which for BAKED DATA is a silent corruption: AgX would
    tone-map a normal map before it ever reached the file. Encoding here means the
    bytes in the file are exactly the bytes computed by the caller.
    """
    raw = bytearray()
    stride = w * 3
    for y in range(h):
        raw.append(0)                                   # filter type 0 (None)
        raw += rgb8[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


def fill_image(img, rgba):
    """
    Fill a float image with an exact RGBA value.

    Deliberately not image.generated_color, which runs the value through Blender's
    colour management: a (0.5, 0.5, 1.0) normal-map background came back as
    (0.21, 0.21, 1.0). For DATA images the numbers have to survive unchanged, so
    they go straight into the pixel buffer.
    """
    w, h = img.size
    buf = np.tile(np.array(rgba, dtype=np.float32), w * h)
    img.pixels.foreach_set(buf)
    return img


def save_bake(img, out_png, srgb, normalise=False, log=print):
    """
    Read a baked float image back and write it to disk.

    `srgb` is not a stylistic choice. A COLOUR map must be sRGB-encoded, because
    Babylon decodes colour textures as sRGB and would otherwise darken everything.
    A DATA map — normals, occlusion, a shadow mask — must be written raw, because
    the shader reads the numbers as numbers; running a gamma curve over a normal
    map tilts every normal towards the surface and the relief goes soft and wrong.
    The game must set gammaSpace to match, or the two halves disagree.

    `normalise` divides by the 99th percentile first. Only for maps that are an
    unbounded QUANTITY (irradiance); anything already expressed as a 0-1 fraction
    must not be rescaled, or whatever the darkest value happens to be gets
    stretched to full brightness.
    """
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    rgb = px[:, :3]

    if normalise:
        lit = rgb[rgb > 1e-4]
        p99 = float(np.percentile(lit, 99.0)) if lit.size else 1.0
        rgb = rgb / max(p99, 1e-3)
    else:
        p99 = 1.0

    v = np.clip(rgb, 0.0, 1.0)
    if srgb:
        v = np.where(v <= 0.0031308, v * 12.92,
                     1.055 * np.power(v, 1.0 / 2.4) - 0.055)
    rgb8 = (np.clip(v, 0, 1) * 255.0 + 0.5).astype(np.uint8)

    w, h = img.size
    # Blender's pixel buffer starts at the BOTTOM row; PNG starts at the top.
    write_png(out_png, rgb8.reshape(h, w, 3)[::-1].tobytes(), w, h)

    stats = {
        'p99': round(float(p99), 5),
        'mean': round(float(v.mean()), 4),
        'belowHalf': round(float((v.max(axis=1) < 0.5).mean()), 4),
        'srgb': bool(srgb),
    }
    log(f'{os.path.basename(out_png)}: {"sRGB" if srgb else "linear"} '
        f'mean={stats["mean"]:.3f} below-half={stats["belowHalf"] * 100:.1f}%'
        + (f' p99={p99:.4f}' if normalise else ''))
    return stats


# ── Deterministic value noise ───────────────────────────────────────────────
# Hash-based rather than random, so the same body is produced on every machine
# and every run. The game's runtime texture generator uses the same construction
# for the same reason.

def _hash3(i, j, k):
    n = (i * 374761393 + j * 668265263 + k * 2147483647) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFFFF) / 0xFFFFFFFF


def value_noise(x, y, z):
    """Trilinearly interpolated value noise in [0, 1]."""
    xi, yi, zi = math.floor(x), math.floor(y), math.floor(z)
    xf, yf, zf = x - xi, y - yi, z - zi
    u = xf * xf * (3 - 2 * xf)
    v = yf * yf * (3 - 2 * yf)
    w = zf * zf * (3 - 2 * zf)
    out = 0.0
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                wgt = ((u if dx else 1 - u)
                       * (v if dy else 1 - v)
                       * (w if dz else 1 - w))
                out += wgt * _hash3(xi + dx, yi + dy, zi + dz)
    return out


def fbm(x, y, z, octaves=4, lacunarity=2.0, gain=0.5):
    total, amp, freq, norm = 0.0, 1.0, 1.0, 0.0
    for _ in range(octaves):
        total += amp * value_noise(x * freq, y * freq, z * freq)
        norm += amp
        amp *= gain
        freq *= lacunarity
    return total / norm
