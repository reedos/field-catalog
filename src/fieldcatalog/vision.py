from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from .animal import infer_animal_type

TYPES = {"bird", "mammal", "herp", "fish", "invertebrate", "other"}

PROMPT = (
    "You are a careful field ornithologist / wildlife identifier. Identify the animal. "
    "Prefer North American taxa if ambiguous. Return ONLY JSON:\n"
    '{ "commonName", "scientificName", "confidence" (0-1), "fieldMarks" (3-6 strings), '
    '"similarSpecies" (0-3), "notes" (one factual sentence, no second-person, do not say you spotted), '
    '"animalType": exactly bird|mammal|herp|fish|invertebrate|other }'
)


class IdentifyError(RuntimeError):
    pass


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


def config_path(library: Path) -> Path:
    return Path(library).expanduser() / "identify.json"


def load_config(library: Path | None = None) -> dict:
    cfg = {
        "backend": "ollama",
        "ollama_url": os.environ.get("OLLAMA_HOST") or "http://127.0.0.1:11434",
        "ollama_model": os.environ.get("OLLAMA_VISION_MODEL") or "muse-glimmer:30b",
    }
    if library:
        p = config_path(library)
        if p.is_file():
            try:
                saved = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(saved, dict):
                    cfg.update({k: saved[k] for k in saved if k in cfg or k == "backend"})
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


def identify_preview(preview_path: str, *, api_key: str = "", library: Path | None = None) -> dict:
    path = Path(preview_path)
    if not path.is_file():
        raise IdentifyError(f"preview missing: {path}")
    raw = path.read_bytes()
    if not raw:
        raise IdentifyError("preview file is empty")
    b64 = base64.b64encode(raw).decode("ascii")
    cfg = load_config(library)
    if cfg["backend"] == "ollama":
        return identify_ollama(b64, cfg)
    return identify_xai(b64, api_key=api_key, library=library)


def identify_ollama(b64: str, cfg: dict) -> dict:
    url = str(cfg.get("ollama_url") or "http://127.0.0.1:11434").rstrip("/") + "/api/chat"
    model = str(cfg.get("ollama_model") or "muse-glimmer:30b")
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
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:800]
        raise IdentifyError(f"Ollama HTTP {e.code}: {detail}") from e
    except Exception as e:
        raise IdentifyError(f"Ollama ({model}): {e}") from e
    text = ""
    if isinstance(payload, dict):
        msg = payload.get("message") or {}
        text = str(msg.get("content") or payload.get("response") or "")
    if not text.strip():
        raise IdentifyError(f"Ollama returned empty content from {model}")
    return parse_identity(text)


def identify_xai(b64: str, *, api_key: str = "", library: Path | None = None) -> dict:
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
    req = urllib.request.Request(
        "https://api.x.ai/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:800]
        raise IdentifyError(f"xAI HTTP {e.code}: {detail}") from e
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
    data = json.loads(blob[start : end + 1])
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
    return {
        "common_name": common,
        "scientific_name": scientific,
        "animal_type": animal,
        "confidence": confidence,
        "field_marks": _str_list(marks),
        "similar_species": _str_list(similar),
        "notes": notes,
    }


def _str_list(raw: object) -> list[str]:
    if isinstance(raw, str):
        return [m.strip() for m in raw.replace("\n", "|").split("|") if m.strip()]
    if isinstance(raw, list):
        return [str(m).strip() for m in raw if str(m).strip()]
    return []
