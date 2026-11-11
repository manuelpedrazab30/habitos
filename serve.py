"""Servidor de desarrollo: como `python3 -m http.server`, pero sin caché.

Sin esto el navegador reutiliza módulos ES antiguos tras editar y aparecen errores
del tipo "does not provide an export named …". Uso: python3 serve.py [puerto]
"""
import socket
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def lan_ip():
    """IP de este equipo en la red local (para abrir la app desde el móvil en la misma wifi)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no envía nada; solo elige la interfaz de salida
            return s.getsockname()[0]
    except OSError:
        return None


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    handler = partial(NoCacheHandler, directory=str(Path(__file__).parent))
    print(f"Sirviendo en http://localhost:{port}")
    if ip := lan_ip():
        print(f"Desde el móvil (misma wifi): http://{ip}:{port}")
    ThreadingHTTPServer(("", port), handler).serve_forever()
