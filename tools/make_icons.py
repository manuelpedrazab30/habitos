"""Genera los iconos PNG de la app (pantalla de inicio de iPhone, Android, favicon).

Sin dependencias: dibuja con campos de distancia (antialiasing analítico) y escribe
PNG con zlib. Diseño, a juego con el tema Clásico en oscuro: fondo casi negro con un
resplandor amarillo arriba y rejilla fina, un anillo discontinuo exterior (como los anillos
que giran de fondo), y el anillo de progreso y el check en amarillo con un ligero brillo.
iOS redondea las esquinas, así que el fondo llega al borde.

Uso: python3 tools/make_icons.py   → icons/icon-{180,192,512}.png
"""
import math
import struct
import zlib
from pathlib import Path

BG_TOP = (24, 26, 35)  # un pelo más claro que --bg (#0f1117) arriba
BG_BOTTOM = (13, 14, 20)
ACCENT = (247, 215, 116)  # --accent en oscuro (#f7d774)
ARC_START = -90  # grados, 0 = derecha; empieza arriba
ARC_SWEEP = 285  # grados de anillo "completado"
GRID = 64  # separación de la rejilla (en coordenadas de 512)
DASHES = 40  # trazos del anillo discontinuo


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def seg_dist(px, py, ax, ay, bx, by):
    """Distancia de un punto a un segmento."""
    dx, dy = bx - ax, by - ay
    t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def mix(col, target, a):
    return [c + (t - c) * a for c, t in zip(col, target)]


def render(size):
    s = size / 512  # todas las medidas en coordenadas de 512
    cx = cy = 256 * s
    radius, thick = 150 * s, 40 * s
    a0 = math.radians(ARC_START)
    a1 = math.radians(ARC_START + ARC_SWEEP)
    caps = [(cx + radius * math.cos(a), cy + radius * math.sin(a)) for a in (a0, a1)]
    check = [(190 * s, 262 * s), (238 * s, 310 * s), (328 * s, 210 * s)]
    check_w = 38 * s
    dash_r, dash_w = 212 * s, 5 * s
    thin_r = 236 * s
    grid, line_w = GRID * s, max(1.0, 1.5 * s)
    glow_r = 26 * s  # alcance del brillo

    rows = []
    for y in range(size):
        t = y / (size - 1)
        row = bytearray([0])  # filtro PNG "None"
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            col = [BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t for i in range(3)]

            # Resplandor amarillo arriba (como el radial-gradient del tema)
            g = math.hypot((px - cx) / (1.3 * size), (py + 0.12 * size) / (0.75 * size))
            col = mix(col, ACCENT, 0.16 * clamp(1 - g) ** 2)

            # Rejilla fina centrada
            gx = abs(((px - cx) % grid) - grid / 2) - (grid / 2 - line_w / 2)
            gy = abs(((py - cy) % grid) - grid / 2) - (grid / 2 - line_w / 2)
            col = mix(col, ACCENT, 0.06 * max(clamp(0.5 + gx), clamp(0.5 + gy)))

            d = math.hypot(px - cx, py - cy)
            ang = math.atan2(py - cy, px - cx)

            # Anillo fino continuo y anillo discontinuo exterior
            col = mix(col, ACCENT, 0.18 * clamp(0.5 - (abs(d - thin_r) - line_w / 2)))
            on = ((ang / (2 * math.pi)) * DASHES) % 1 < 0.55
            if on:
                col = mix(col, ACCENT, 0.5 * clamp(0.5 - (abs(d - dash_r) - dash_w / 2)))

            # Anillo de progreso: pista tenue + arco con extremos redondeados
            ring = abs(d - radius) - thick / 2
            rel = (ang - a0) % (2 * math.pi)
            if rel <= a1 - a0:
                arc = ring
            else:
                arc = min(math.hypot(px - cx_, py - cy_) for cx_, cy_ in caps) - thick / 2
            chk = min(seg_dist(px, py, *check[0], *check[1]), seg_dist(px, py, *check[1], *check[2])) - check_w / 2

            # Brillo suave alrededor del arco y del check
            near = min(arc, chk)
            if near > 0:
                col = mix(col, ACCENT, 0.28 * math.exp(-near / glow_r * 3))
            for sdf, alpha in ((ring, 0.14), (arc, 1.0), (chk, 1.0)):
                cov = clamp(0.5 - sdf) * alpha
                if cov:
                    col = mix(col, ACCENT, cov)
            row += bytes(int(round(clamp(c, 0, 255))) for c in col)
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size, raw):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8 bits, RGB
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    for size in (180, 192, 512):
        write_png(out / f"icon-{size}.png", size, render(size))
        print(f"icons/icon-{size}.png")
