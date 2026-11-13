"""Genera los iconos PNG de la app (pantalla de inicio de iPhone, Android, favicon).

Sin dependencias: dibuja con campos de distancia (antialiasing analítico) y escribe
PNG con zlib. Diseño: fondo degradado amarillo claro→ámbar, anillo de progreso (como el de
la vista Hoy) y un check en marrón oscuro (contraste sobre amarillo). iOS redondea las esquinas, así que el fondo llega al borde.

Uso: python3 tools/make_icons.py   → icons/icon-{180,192,512}.png
"""
import math
import struct
import zlib
from pathlib import Path

TOP = (255, 226, 130)  # amarillo claro
BOTTOM = (240, 182, 52)  # ámbar
GLYPH = (42, 31, 0)  # #2a1f00, el mismo tono que --accent-ink
ARC_START = -90  # grados, 0 = derecha; empieza arriba
ARC_SWEEP = 285  # grados de anillo "completado"


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def seg_dist(px, py, ax, ay, bx, by):
    """Distancia de un punto a un segmento."""
    dx, dy = bx - ax, by - ay
    t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def render(size):
    s = size / 512  # todas las medidas en coordenadas de 512
    cx = cy = 256 * s
    radius, thick = 150 * s, 46 * s
    a0 = math.radians(ARC_START)
    a1 = math.radians(ARC_START + ARC_SWEEP)
    caps = [(cx + radius * math.cos(a), cy + radius * math.sin(a)) for a in (a0, a1)]
    check = [(184 * s, 262 * s), (236 * s, 314 * s), (334 * s, 206 * s)]
    check_w = 42 * s

    rows = []
    for y in range(size):
        t = y / (size - 1)
        bg = [TOP[i] + (BOTTOM[i] - TOP[i]) * t for i in range(3)]
        row = bytearray([0])  # filtro PNG "None"
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            d = math.hypot(px - cx, py - cy)
            ring = abs(d - radius) - thick / 2  # anillo completo (pista tenue)

            ang = (math.atan2(py - cy, px - cx) - a0) % (2 * math.pi)
            if ang <= a1 - a0:
                arc = ring
            else:  # fuera del arco: distancia a los extremos redondeados
                arc = min(math.hypot(px - cx_, py - cy_) for cx_, cy_ in caps) - thick / 2

            chk = min(seg_dist(px, py, *check[0], *check[1]), seg_dist(px, py, *check[1], *check[2])) - check_w / 2

            col = bg
            for sdf, alpha in ((ring, 0.18), (arc, 1.0), (chk, 1.0)):
                cov = clamp(0.5 - sdf) * alpha
                if cov:
                    col = [c + (w - c) * cov for c, w in zip(col, GLYPH)]
            row += bytes(int(round(c)) for c in col)
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
