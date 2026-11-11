"""Servidor de desarrollo: como `python3 -m http.server`, pero sin caché.

Sin esto el navegador reutiliza módulos ES antiguos tras editar y aparecen errores
del tipo "does not provide an export named …". Uso: python3 serve.py [puerto]
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    handler = partial(NoCacheHandler, directory=str(Path(__file__).parent))
    print(f"Sirviendo en http://localhost:{port}")
    ThreadingHTTPServer(("", port), handler).serve_forever()
