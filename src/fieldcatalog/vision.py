from __future__ import annotations

import base64
import http.client
import socket
import threading
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from .animal import infer_animal_type, title_common, title_scientific

TYPES = {"bird", "mammal", "herp", "fish", "invertebrate", "other"}

# Any Ollama vision model works; this is only the default for a fresh library.
# Chosen because `ollama pull llama3.2-vision` works on an ordinary machine.
# Override per library in identify.json, or with OLLAMA_VISION_MODEL.
DEFAULT_OLLAMA_MODEL = "llama3.2-vision"

PROMPT = (
    "You are a careful field ornithologist / wildlife identifier. Identify the animal. "
    "Prefer North American taxa if ambiguous. Return ONLY JSON:\n"
    '{ "commonName", "scientificName", "confidence" (0-1), "fieldMarks" (3-6 strings), '
    '"similarSpecies" (0-3), "notes" (one factual sentence, no second-person, do not say you spotted), '
    '"animalType": exactly bird|mammal|herp|fish|invertebrate|other, '
    '"subject": [x, y, w, h] as fractions of image width/height for the tightest '
    "box around the animal, or null if you cannot place it confidently }"
)


class IdentifyError(RuntimeError):
    pass


class CancelToken:
    """Lets another thread abort an in-flight identify by closing its socket.

    urllib offers no way to interrupt a blocking read; http.client does, if you
    hold the connection. The serve process registers the active token so a
    fast-lane identify-cancel request can reach a slow-lane call mid-flight.
    """

    def __init__(self) -> None:
        self._conn: http.client.HTTPConnection | None = None
        self.cancelled = False

    def attach(self, conn: http.client.HTTPConnection) -> None:
        self._conn = conn
        if self.cancelled:
            self._close()

    def cancel(self) -> None:
        self.cancelled = True
        self._close()

    def _close(self) -> None:
        conn = self._conn
        if conn is None:
            return
        # On Windows, close() alone does not interrupt a recv blocked in
        # another thread; shutdown() does.
        sock = getattr(conn, "sock", None)
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        try:
            conn.close()
        except Exception:
            pass


def _post_json(url: str, body: dict, headers: dict, *, timeout: float, cancel: CancelToken | None) -> dict:
    """POST and parse JSON, abortable via `cancel`.

    The blocking exchange runs on a throwaway daemon thread and the caller
    waits with cancel checks: on Windows, closing or shutting down a socket
    does NOT reliably interrupt another thread's recv, so the only dependable
    cancel is to stop waiting. The socket shutdown still happens best-effort
    so the abandoned thread usually dies quickly rather than at its timeout.
    """
    outcome: dict = {}
    done = threading.Event()

    def work() -> None:
        try:
            outcome["value"] = _post_json_blocking(url, body, headers, timeout=timeout, cancel=cancel)
        except Exception as e:  # delivered to the waiting thread
            outcome["error"] = e
        finally:
            done.set()

    worker = threading.Thread(target=work, daemon=True)
    worker.start()
    while not done.wait(0.2):
        if cancel is not None and cancel.cancelled:
            cancel._close()
            raise IdentifyError("identify cancelled")
    if "error" in outcome:
        err = outcome["error"]
        if cancel is not None and cancel.cancelled:
            raise IdentifyError("identify cancelled") from err
        raise err
    if cancel is not None and cancel.cancelled:
        raise IdentifyError("identify cancelled")
    return outcome["value"]


def _post_json_blocking(url: str, body: dict, headers: dict, *, timeout: float, cancel: CancelToken | None) -> dict:
    parts = urlsplit(url)
    conn_cls = http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(parts.hostname or "127.0.0.1", parts.port, timeout=timeout)
    if cancel is not None:
        cancel.attach(conn)
    try:
        path = parts.path or "/"
        if parts.query:
            path = f"{path}?{parts.query}"
        conn.request("POST", path, json.dumps(body).encode("utf-8"), {"Content-Type": "application/json", **headers})
        resp = conn.getresponse()
        status = resp.status
        data = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        if cancel is not None and cancel.cancelled:
            raise IdentifyError("identify cancelled") from e
        raise
    finally:
        conn.close()
    if cancel is not None and cancel.cancelled:
        raise IdentifyError("identify cancelled")
    if status != 200:
        raise IdentifyError(f"HTTP {status}: {data[:800]}")
    try:
        return json.loads(data)
    except json.JSONDecodeError as e:
        raise IdentifyError(f"response was not JSON: {data[:200]}") from e


def key_path(library: Path) -> Path:
    return Path(library).expanduser() / "xai.key"


def load_api_key(library: Path | None = None) -> str:
    env = (os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY") or "").strip()
    if env:
        return env
    if library:
        p = key_path(library)
        if p.is_file():
            return p.read_text(encoding="utf-8").strip()
    return ""


def save_api_key(library: Path, key: str) -> None:
    p = key_path(library)
    p.write_text((key or "").strip(), encoding="utf-8")
    # Best effort: meaningful on POSIX, a no-op on Windows where ACLs govern.
    try:
        p.chmod(0o600)
    except OSError:
        pass


def config_path(library: Path) -> Path:
    return Path(library).expanduser() / "identify.json"


def load_config(library: Path | None = None) -> dict:
    cfg = {
        "backend": "ollama",
        "ollama_url": os.environ.get("OLLAMA_HOST") or "http://127.0.0.1:11434",
        "ollama_model": os.environ.get("OLLAMA_VISION_MODEL") or DEFAULT_OLLAMA_MODEL,
    }
    if library:
        p = config_path(library)
        if p.is_file():
            try:
                saved = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(saved, dict):
                    cfg.update({k: saved[k] for k in saved if k in cfg})
            except json.JSONDecodeError:
                pass
    backend = str(cfg.get("backend") or "ollama").strip().lower()
    if backend not in ("ollama", "xai"):
        backend = "ollama"
    cfg["backend"] = backend
    return cfg


def save_config(library: Path, **fields: object) -> dict:
    cfg = load_config(library)
    for k, v in fields.items():
        if v is None or v == "":
            continue
        cfg[k] = v
    if cfg.get("backend") not in ("ollama", "xai"):
        cfg["backend"] = "ollama"
    config_path(library).write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return cfg


def identify_preview(
    preview_path: str, *, api_key: str = "", library: Path | None = None, cancel: CancelToken | None = None
) -> dict:
    path = Path(preview_path)
    if not path.is_file():
        raise IdentifyError(f"preview missing: {path}")
    raw = path.read_bytes()
    if not raw:
        raise IdentifyError("preview file is empty")
    b64 = base64.b64encode(raw).decode("ascii")
    cfg = load_config(library)
    if cfg["backend"] == "ollama":
        return identify_ollama(b64, cfg, cancel=cancel)
    return identify_xai(b64, api_key=api_key, library=library, cancel=cancel)


def identify_ollama(b64: str, cfg: dict, *, cancel: CancelToken | None = None) -> dict:
    url = str(cfg.get("ollama_url") or "http://127.0.0.1:11434").rstrip("/") + "/api/chat"
    model = str(cfg.get("ollama_model") or DEFAULT_OLLAMA_MODEL)
    body = {
        "model": model,
        "stream": False,
        "think": False,
        "options": {"temperature": 0.1},
        "messages": [
            {"role": "system", "content": PROMPT},
            {
                "role": "user",
                "content": "Identify this animal. JSON only.",
                "images": [b64],
            },
        ],
    }
    try:
        payload = _post_json(url, body, {}, timeout=300, cancel=cancel)
    except IdentifyError as e:
        detail = str(e)
        if "not found" in detail.lower() or "404" in detail:
            raise IdentifyError(
                f"Ollama has no model named {model!r}. Pull it with "
                f"`ollama pull {model}`, or pick another vision model in "
                f"Settings. Identification is optional -- you can type species "
                f"names in the detail panel instead."
            ) from e
        raise
    except (ConnectionError, OSError) as e:
        raise IdentifyError(
            f"Could not reach Ollama at {cfg.get('ollama_url')}. Start it with "
            f"`ollama serve`, switch Identify to xAI in Settings, or type "
            f"species names by hand -- identification is optional."
        ) from e
    except Exception as e:
        raise IdentifyError(f"Ollama ({model}): {e}") from e
    text = ""
    if isinstance(payload, dict):
        msg = payload.get("message") or {}
        text = str(msg.get("content") or payload.get("response") or "")
    if not text.strip():
        raise IdentifyError(f"Ollama returned empty content from {model}")
    return parse_identity(text)


def identify_xai(
    b64: str, *, api_key: str = "", library: Path | None = None, cancel: CancelToken | None = None
) -> dict:
    key = (api_key or load_api_key(library)).strip()
    if not key:
        raise IdentifyError("XAI_API_KEY is not set. Add it in Settings or switch Identify to local Ollama.")
    model = os.environ.get("XAI_VISION_MODEL") or "grok-2-vision-1212"
    body = {
        "model": model,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    {"type": "text", "text": "Identify this animal. JSON only."},
                ],
            },
        ],
    }
    try:
        payload = _post_json(
            "https://api.x.ai/v1/chat/completions",
            body,
            {"Authorization": f"Bearer {key}"},
            timeout=90,
            cancel=cancel,
        )
    except IdentifyError:
        raise
    except Exception as e:
        raise IdentifyError(str(e)) from e
    try:
        text = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise IdentifyError(f"xAI response missing content: {payload!r}"[:400]) from e
    return parse_identity(text)


def _pick(data: dict, *names: str) -> object:
    for n in names:
        if n in data and data[n] not in (None, ""):
            return data[n]
    return None


def parse_identity(text: str) -> dict:
    blob = text.strip()
    if blob.startswith("```"):
        blob = blob.strip("`")
        if blob.lower().startswith("json"):
            blob = blob[4:]
    start, end = blob.find("{"), blob.rfind("}")
    if start < 0 or end <= start:
        raise IdentifyError("identify returned no JSON")
    try:
        data = json.loads(blob[start : end + 1])
    except json.JSONDecodeError as e:
        raise IdentifyError(f"identify returned malformed JSON: {e}") from e
    common = str(_pick(data, "commonName", "common_name") or "").strip()
    if not common:
        raise IdentifyError("identify returned no common name")
    scientific = str(_pick(data, "scientificName", "scientific_name") or "").strip() or None
    animal = str(_pick(data, "animalType", "animal_type") or "").strip().lower()
    if animal not in TYPES:
        animal = infer_animal_type(common, scientific) or "other"
    conf = _pick(data, "confidence")
    try:
        confidence = float(conf) if conf is not None else None
    except (TypeError, ValueError):
        confidence = None
    if confidence is not None:
        confidence = max(0.0, min(1.0, confidence if confidence <= 1 else confidence / 100.0))
    marks = _pick(data, "fieldMarks", "field_marks") or []
    similar = _pick(data, "similarSpecies", "similar_species") or []
    notes = str(_pick(data, "notes") or "").strip()
    subject = _subject_box(_pick(data, "subject", "subject_box", "bbox", "box"))
    return {
        "subject_box": subject,
        "common_name": title_common(common),
        "scientific_name": title_scientific(scientific),
        "animal_type": animal,
        "confidence": confidence,
        "field_marks": _str_list(marks),
        "similar_species": _str_list(similar),
        "notes": notes,
    }


def _subject_box(raw: object) -> list[float] | None:
    """Validate a model-supplied box, or return None.

    Vision models are strong at naming an animal and weak at placing it, so
    this is deliberately suspicious: anything malformed, inverted, out of
    range, vanishingly small or nearly the whole frame is discarded rather
    than trusted. A box covering the entire image says "somewhere in here",
    which is what we already knew.
    """
    if isinstance(raw, dict):
        raw = [raw.get(k) for k in ("x", "y", "w", "h")]
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        return None
    try:
        x, y, w, h = (float(v) for v in raw)
    except (TypeError, ValueError):
        return None
    # Some models answer in percentages rather than fractions.
    if max(x, y, w, h) > 1.0:
        x, y, w, h = (v / 100.0 for v in (x, y, w, h))
    if not all(0.0 <= v <= 1.0 for v in (x, y, w, h)):
        return None
    if w <= 0.01 or h <= 0.01:
        return None
    if x + w > 1.001 or y + h > 1.001:
        return None
    if w * h > 0.9:
        return None
    return [round(x, 4), round(y, 4), round(min(w, 1.0 - x), 4), round(min(h, 1.0 - y), 4)]


def _str_list(raw: object) -> list[str]:
    if isinstance(raw, str):
        return [m.strip() for m in raw.replace("\n", "|").split("|") if m.strip()]
    if isinstance(raw, list):
        return [str(m).strip() for m in raw if str(m).strip()]
    return []
