"""`fieldcatalog web` -- the same app, served to a phone.

The desktop shell talks to the worker over a pipe. This talks to it over HTTP, so
the React UI can run in a phone's browser against the same library: keep and
reject from the sofa, name a bird on the train, label a day's shooting in a queue.

It is meant for a private network (a tailnet), not the internet. There is no
login: what reaches this port is trusted, so bind it to an address only your own
devices can reach. What it does defend is the library and the disk:

* Commands are allowlisted. Only what the UI sends is accepted, and the flags
  that lift a safety rule (`--permanent`, `--no-backup`, `--allow-any-verdict`)
  are refused here however they arrive. The desktop never sends them either.
* Hard rule 3 holds at this layer too: an `--execute` is accepted only for the
  exact set of ids that was dry-run from the same address in the last ten
  minutes. A stray request cannot remove a file nobody was shown.
* Requests must be JSON, from this origin, addressed to a host name we answer
  to -- so a web page open in the same phone browser cannot drive it (no
  cross-site POST, no DNS rebinding).
* Files are served from the library's previews folder and nowhere else. The loupe
  reads an original to cut one region out of it; it never sends the file.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import mimetypes
import os
import queue
import subprocess
import threading
import time
from concurrent.futures import Future
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

DEFAULT_PORT = 8795
THUMB_WIDTHS = (320, 480, 800)
LOUPE_MAX = 1600                      # px on a side, of the original, per loupe request
DRY_RUN_TTL = 600                     # seconds an --execute may follow its dry run
MAX_BODY = 64 * 1024

# Exactly the subcommands ui/src/lib/worker.ts sends. Anything else is refused.
ALLOWED = frozenset({
    "init", "list", "get", "field-marks", "set-verdict", "set", "set-location",
    "set-location-by-date", "identify", "identify-cancel", "life-list-pick", "clear-identity",
    "set-key", "key-status", "set-identify", "bursts", "pending-deletes", "delete-originals",
    "offload-originals", "import", "export-originals", "refresh-previews", "audit",
})
# These lift a safety rule. The UI never sends them; over a network nothing may.
# Named as argparse stores them: the check reads the PARSED request, because
# argparse also accepts any unambiguous abbreviation ("--perm", "--exec").
REFUSED_OPTIONS = ("permanent", "no_backup", "allow_any_verdict")
DISK_COMMANDS = frozenset({"delete-originals", "offload-originals"})


class Refused(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def tailscale_ip() -> str:
    """This machine's tailnet IPv4 address, for --host tailscale."""
    for exe in ("tailscale", r"C:\Program Files\Tailscale\tailscale.exe"):
        try:
            out = subprocess.run([exe, "ip", "-4"], capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.SubprocessError):
            continue
        ip = (out.stdout or "").strip().splitlines()
        if out.returncode == 0 and ip:
            return ip[0].strip()
    raise SystemExit("could not ask tailscale for this machine's address; pass --host <ip>")


def default_ui_dir() -> Path:
    env = os.environ.get("FIELDCATALOG_UI")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "ui" / "dist"


# --- running worker commands ---------------------------------------------------


class Lanes:
    """Two worker threads, as in `serve`: quick commands never queue behind a slow
    identify or import. Each lane keeps its own sqlite connection (WAL makes the
    pair safe), which is why requests are handed over rather than run on the
    HTTP thread that received them."""

    def __init__(self, library: str):
        self.library = str(library)
        self._queues = {"fast": queue.Queue(), "slow": queue.Queue()}
        for name, q in self._queues.items():
            threading.Thread(target=self._drain, args=(q,), name=f"fc-{name}", daemon=True).start()

    def _drain(self, q: queue.Queue) -> None:
        while True:
            argv, future = q.get()
            try:
                future.set_result(self._run(argv))
            except BaseException as exc:  # noqa: BLE001 -- the HTTP thread must get an answer
                future.set_result({"ok": False, "error": str(exc)})

    def _run(self, argv: list[str]) -> dict:
        from . import cli

        try:
            ns = cli.build_parser().parse_args(["--library", self.library, *argv])
        except SystemExit:
            return {"ok": False, "error": f"bad arguments: {argv}"}
        buf = io.StringIO()
        cli._CAPTURE.buf = buf
        try:
            ns.func(ns)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}
        finally:
            cli._CAPTURE.buf = None
        try:
            return json.loads(buf.getvalue())
        except ValueError:
            return {"ok": False, "error": "worker produced no JSON"}

    def run(self, argv: list[str], timeout: float = 900) -> dict:
        from .cli import SLOW_COMMANDS

        future: Future = Future()
        self._queues["slow" if argv[0] in SLOW_COMMANDS else "fast"].put((argv, future))
        return future.result(timeout=timeout)


class DryRuns:
    """What has been shown, to whom, and when -- so an execute can be checked against it."""

    def __init__(self):
        self._seen: dict[tuple[str, str, str], float] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _ids(ids: str) -> str:
        return hashlib.sha256(",".join(sorted(i for i in (ids or "").split(",") if i)).encode()).hexdigest()

    def check(self, client: str, command: str, ns: argparse.Namespace) -> None:
        """Record a dry run, or refuse an execute that no dry run covers."""
        key = (client, command, self._ids(getattr(ns, "ids", "")))
        now = time.time()
        with self._lock:
            self._seen = {k: t for k, t in self._seen.items() if now - t < DRY_RUN_TTL}
            if not getattr(ns, "execute", False):
                self._seen[key] = now
                return
            if key not in self._seen:
                raise Refused(409, "refusing to remove files that were not listed first: run the same "
                                   "request without --execute, look at the list, then repeat it")
            del self._seen[key]          # one look, one removal


def check_command(library: str, argv) -> argparse.Namespace:
    """Refuse what may not be asked over a network; return the request as parsed.

    Judged on the parsed namespace, not on the strings: "--perm" is "--permanent"
    to argparse, and a check that reads argv would wave it through."""
    from . import cli

    if not isinstance(argv, list) or not argv or not all(isinstance(a, str) for a in argv):
        raise Refused(400, "args must be a non-empty list of strings")
    if argv[0] not in ALLOWED:
        raise Refused(403, f"'{argv[0]}' is not available over the network")
    try:
        ns = cli.build_parser().parse_args(["--library", library, *argv])
    except SystemExit:
        raise Refused(400, f"bad arguments for {argv[0]}")
    if str(ns.library) != library:
        raise Refused(403, "the library is fixed when the server starts")
    for option in REFUSED_OPTIONS:
        if getattr(ns, option, False):
            raise Refused(403, f"--{option.replace('_', '-')} is not accepted over the network")
    return ns


# --- images ----------------------------------------------------------------------


def _inside(folder: Path, target: Path) -> bool:
    try:
        target.resolve().relative_to(folder.resolve())
        return True
    except (ValueError, OSError):
        return False


def thumbnail(library: Path, preview: Path, width: int) -> Path:
    """A smaller copy of a preview, for grids on a phone connection. Cached in the
    library's own web-cache folder; the preview itself is never touched."""
    from PIL import Image

    cache = library / "web-cache" / "thumbs"
    dest = cache / f"{preview.stem}_{width}.jpg"
    if dest.is_file() and dest.stat().st_mtime >= preview.stat().st_mtime:
        return dest
    cache.mkdir(parents=True, exist_ok=True)
    with Image.open(preview) as im:
        im = im.convert("RGB")
        im.thumbnail((width, width * 2), Image.Resampling.LANCZOS)
        tmp = dest.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        im.save(tmp, "JPEG", quality=80, optimize=True)
    os.replace(tmp, dest)
    return dest


def loupe_region(original: Path, cx: float, cy: float, size: int) -> bytes:
    """`size` x `size` pixels of the original at 1:1, centred on (cx, cy) as fractions
    of the upright frame. The 1:1 loupe, without sending a 30 MB file to a phone."""
    from PIL import Image, ImageOps

    with Image.open(original) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        w, h = im.size
        size = max(200, min(LOUPE_MAX, size, w, h))
        left = min(max(round(cx * w - size / 2), 0), w - size)
        top = min(max(round(cy * h - size / 2), 0), h - size)
        region = im.crop((left, top, left + size, top + size))
    buf = io.BytesIO()
    region.save(buf, "JPEG", quality=88)          # no EXIF: nothing from the original but pixels
    return buf.getvalue()


# --- the server ------------------------------------------------------------------


class App:
    def __init__(self, library: str, ui_dir: Path, hosts: set[str]):
        self.library = Path(library).expanduser()
        self.ui_dir = Path(ui_dir)
        self.hosts = {h.lower() for h in hosts}
        self.lanes = Lanes(str(self.library))
        self.dry_runs = DryRuns()

    def worker(self, client: str, argv) -> dict:
        ns = check_command(str(self.library), argv)
        if argv[0] in DISK_COMMANDS:
            self.dry_runs.check(client, argv[0], ns)
        return self.lanes.run(argv)


class Handler(BaseHTTPRequestHandler):
    app: App
    server_version = "FieldCatalogWeb"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # noqa: D102 -- one line per request, to stderr
        print(f"[{self.log_date_time_string()}] {self.client_address[0]} {fmt % args}", flush=True)

    # -- guards --

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        return host in self.app.hosts

    def _origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True                      # same-origin GETs and non-browser clients send none
        return (urlsplit(origin).hostname or "").lower() in self.app.hosts

    # -- replies --

    def _send(self, status: int, body: bytes, ctype: str, cache: str = "no-store") -> None:
        if len(body) > 1024 and "gzip" in (self.headers.get("Accept-Encoding") or "") \
                and ctype.split(";")[0] in ("application/json", "text/html", "text/css",
                                             "application/javascript", "text/javascript", "image/svg+xml"):
            body = gzip.compress(body, compresslevel=5)
            encoding = "gzip"
        else:
            encoding = None
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        if encoding:
            self.send_header("Content-Encoding", encoding)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, payload: dict) -> None:
        self._send(status, json.dumps(payload, default=str).encode(), "application/json")

    def _file(self, path: Path, cache: str) -> None:
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self._send(HTTPStatus.OK, path.read_bytes(), ctype, cache)

    # -- routes --

    def do_HEAD(self):  # noqa: N802
        self.do_GET()

    def do_GET(self):  # noqa: N802
        if not self._host_ok():
            return self._json(421, {"ok": False, "error": "this server does not answer to that host name"})
        url = urlsplit(self.path)
        query = parse_qs(url.query)

        def one(name: str) -> str:
            return (query.get(name) or [""])[0]

        try:
            if url.path == "/api/paths":
                return self._json(200, {"cli": "fieldcatalog web", "library": str(self.app.library), "web": True})
            if url.path == "/api/file":
                return self._preview(one("path"), one("w"))
            if url.path == "/api/loupe":
                return self._loupe(one("id"), one("cx"), one("cy"), one("size"))
            if url.path.startswith("/api/"):
                return self._json(404, {"ok": False, "error": "unknown endpoint"})
            return self._static(url.path)
        except Refused as exc:
            return self._json(exc.status, {"ok": False, "error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            return self._json(500, {"ok": False, "error": str(exc)})

    def do_POST(self):  # noqa: N802
        # Read the body before anything else: the connection is kept alive, and a
        # reply sent with the body still unread would have it parsed as the next request.
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if not 0 <= length <= MAX_BODY:
            self.close_connection = True
            return self._json(413, {"ok": False, "error": "request too large"})
        body = self.rfile.read(length)
        if not self._host_ok():
            return self._json(421, {"ok": False, "error": "this server does not answer to that host name"})
        if urlsplit(self.path).path != "/api/worker":
            return self._json(404, {"ok": False, "error": "unknown endpoint"})
        # A cross-site form can POST text/plain without asking; it cannot POST JSON.
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json"                 or not self._origin_ok():
            return self._json(403, {"ok": False, "error": "requests must be JSON from this app"})
        try:
            argv = json.loads(body or b"{}").get("args")
            return self._json(200, self.app.worker(self.client_address[0], argv))
        except Refused as exc:
            return self._json(exc.status, {"ok": False, "error": str(exc)})
        except (ValueError, AttributeError):
            return self._json(400, {"ok": False, "error": "body must be JSON: {\"args\": [...]}"})
        except Exception as exc:  # noqa: BLE001
            return self._json(500, {"ok": False, "error": str(exc)})

    def _preview(self, raw: str, width: str) -> None:
        previews = self.app.library / "previews"
        path = Path(raw) if raw else None
        if not path or not _inside(previews, path) or not path.is_file():
            raise Refused(404, "not found")
        if width:
            if not width.isdigit() or int(width) not in THUMB_WIDTHS:
                raise Refused(400, f"w must be one of {', '.join(map(str, THUMB_WIDTHS))}")
            path = thumbnail(self.app.library, path, int(width))
        self._file(path, "private, max-age=86400")

    def _loupe(self, shot_id: str, cx: str, cy: str, size: str) -> None:
        try:
            fx, fy = float(cx), float(cy)
            px = int(size or 1200)
        except ValueError:
            raise Refused(400, "cx and cy are fractions of the frame; size is pixels")
        if not (0 <= fx <= 1 and 0 <= fy <= 1):
            raise Refused(400, "cx and cy must be between 0 and 1")
        got = self.app.lanes.run(["get", "--id", shot_id])
        shot = got.get("shot") if got.get("ok") else None
        if not shot:
            raise Refused(404, "unknown shot")
        original = Path(shot.get("original_path") or "")
        if shot.get("original_status") != "present" or not original.is_file():
            raise Refused(404, "the original is not on this disk")
        self._send(200, loupe_region(original, fx, fy, px), "image/jpeg", "private, max-age=3600")

    def _static(self, url_path: str) -> None:
        ui = self.app.ui_dir
        rel = url_path.lstrip("/") or "index.html"
        target = ui / rel
        if not _inside(ui, target) or not target.is_file():
            target = ui / "index.html"            # the UI is a single page; let it route
            if not target.is_file():
                raise Refused(503, f"the UI has not been built: run `npm --prefix ui run build` ({ui})")
        hashed = "/assets/" in url_path
        self._file(target, "public, max-age=31536000, immutable" if hashed else "no-cache")


def make_server(library: str, host: str, port: int, ui_dir: Path, extra_hosts=()) -> ThreadingHTTPServer:
    hosts = {host, "localhost", "127.0.0.1", *extra_hosts}
    handler = type("BoundHandler", (Handler,), {"app": App(library, ui_dir, hosts)})
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


def cmd_web(ns: argparse.Namespace) -> int:
    host = tailscale_ip() if ns.host == "tailscale" else ns.host
    ui_dir = Path(ns.ui) if ns.ui else default_ui_dir()
    extra = [h.strip() for h in (ns.allow_host or "").split(",") if h.strip()]
    server = make_server(ns.library, host, ns.port, ui_dir, extra)
    print(f"Field Catalog on http://{host}:{ns.port}/  (library {ns.library})", flush=True)
    if extra:
        print(f"also answering to: {', '.join(extra)}", flush=True)
    if not (ui_dir / "index.html").is_file():
        print(f"warning: no built UI at {ui_dir} -- run `npm --prefix ui run build`", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("stopped", flush=True)
    return 0
