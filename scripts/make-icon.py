#!/usr/bin/env python3
"""
Draw the app icon, then let `tauri icon` build the platform set from it.

    python3 scripts/make-icon.py            # writes src-tauri/icons/icon.png
    npx tauri icon src-tauri/icons/icon.png # regenerates every size + .icns/.ico

No image libraries: the shapes are signed-distance fields evaluated per pixel,
so the edges are anti-aliased and the result is deterministic and reviewable in
a diff.
"""
import math
import struct
import sys
import zlib
from pathlib import Path

SIZE = 1024
OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "icon.png"

# Palette: the same navy/teal/gold the app's charts use.
TOP = (0x0B, 0x12, 0x20)
BOTTOM = (0x0F, 0x76, 0x6E)
LINE = (0xFF, 0xFF, 0xFF)
GOLD = (0xF5, 0xC4, 0x51)
GOLD_DARK = (0xB4, 0x83, 0x1C)


def clamp(value, low=0.0, high=1.0):
    return low if value < low else high if value > high else value


def rounded_rect_distance(x, y, cx, cy, half_w, half_h, radius):
    """Signed distance to a rounded rectangle (negative inside)."""
    dx = abs(x - cx) - (half_w - radius)
    dy = abs(y - cy) - (half_h - radius)
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    inside = min(max(dx, dy), 0.0)
    return outside + inside - radius


def segment_distance(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    length_sq = vx * vx + vy * vy
    t = 0.0 if length_sq == 0 else clamp((wx * vx + wy * vy) / length_sq)
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def coverage(distance, half_width):
    """Approximate pixel coverage of a shape from its distance, in pixels."""
    return clamp(0.5 - distance / 1.0) if False else clamp(0.5 - (distance - half_width))


def main():
    n = SIZE
    margin = n * 0.055
    half = (n - 2 * margin) / 2
    cx = cy = n / 2
    radius = half * 0.42

    # Chart geometry, in fractions of the icon box.
    pts = [(0.205, 0.615), (0.385, 0.440), (0.565, 0.520), (0.795, 0.300)]
    pts = [(margin + (n - 2 * margin) * fx, margin + (n - 2 * margin) * fy) for fx, fy in pts]
    line_half = n * 0.022
    dot_radius = n * 0.030

    # Coin, clear of the line, lower right.
    coin_cx, coin_cy = margin + (n - 2 * margin) * 0.740, margin + (n - 2 * margin) * 0.735
    coin_r = n * 0.062

    rows = []
    for y in range(n):
        row = bytearray()
        py = y + 0.5
        for x in range(n):
            px = x + 0.5
            d_rect = rounded_rect_distance(px, py, cx, cy, half, half, radius)
            # Background: rounded square with a diagonal gradient.
            r = g = b = 0
            if d_rect < 1.5:
                t = clamp(((px - margin) + (py - margin)) / (2 * (n - 2 * margin)))
                # Slight vertical bias reads better at small sizes.
                t = clamp(t * 0.82 + (py - margin) / (n - 2 * margin) * 0.18)
                br = TOP[0] + (BOTTOM[0] - TOP[0]) * t
                bg = TOP[1] + (BOTTOM[1] - TOP[1]) * t
                bb = TOP[2] + (BOTTOM[2] - TOP[2]) * t
                # Top highlight.
                shine = clamp(1.0 - (py - margin) / (n * 0.22)) * 0.10
                br, bg, bb = br + (255 - br) * shine, bg + (255 - bg) * shine, bb + (255 - bb) * shine
                alpha = clamp(0.5 - d_rect)

                # Chart line.
                d_line = min(
                    segment_distance(px, py, *pts[i], *pts[i + 1]) for i in range(len(pts) - 1)
                )
                line_a = clamp(0.5 - (d_line - line_half))
                if line_a > 0:
                    br = br + (LINE[0] - br) * line_a
                    bg = bg + (LINE[1] - bg) * line_a
                    bb = bb + (LINE[2] - bb) * line_a

                # Data points.
                for dx, dy in pts:
                    d_dot = math.hypot(px - dx, py - dy) - dot_radius
                    dot_a = clamp(0.5 - d_dot)
                    if dot_a > 0:
                        # A ring of background colour keeps the dots readable on the line.
                        br = br + (LINE[0] - br) * dot_a
                        bg = bg + (LINE[1] - bg) * dot_a
                        bb = bb + (LINE[2] - bb) * dot_a

                # Coin.
                d_coin = math.hypot(px - coin_cx, py - coin_cy) - coin_r
                coin_a = clamp(0.5 - d_coin)
                if coin_a > 0:
                    ring = clamp(0.5 - (abs(d_coin + coin_r * 0.34) - coin_r * 0.10))
                    cr, cg, cb = GOLD
                    if ring > 0:
                        cr = cr + (GOLD_DARK[0] - cr) * ring
                        cg = cg + (GOLD_DARK[1] - cg) * ring
                        cb = cb + (GOLD_DARK[2] - cb) * ring
                    br = br + (cr - br) * coin_a
                    bg = bg + (cg - bg) * coin_a
                    bb = bb + (cb - bb) * coin_a

                r, g, b = br, bg, bb
                out_a = alpha
            else:
                out_a = 0.0

            row += bytes((int(clamp(r, 0, 255)), int(clamp(g, 0, 255)), int(clamp(b, 0, 255)), int(out_a * 255)))
        rows.append(bytes(row))

    raw = b"".join(b"\x00" + row for row in rows)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(png)
    print(f"wrote {OUT} ({len(png)} bytes)")


def point_in_polygon(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
        j = i
    return inside


def chunk(kind, data):
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


if __name__ == "__main__":
    sys.exit(main())
