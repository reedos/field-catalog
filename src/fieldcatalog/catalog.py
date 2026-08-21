from __future__ import annotations

import sqlite3
from pathlib import Path

from .models import Shot

SCHEMA = """
CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  original_path TEXT NOT NULL UNIQUE,
  preview_path TEXT NOT NULL,
  original_status TEXT NOT NULL DEFAULT 'present',
  display_name TEXT,
  common_name TEXT,
  scientific_name TEXT,
  animal_type TEXT,
  captured_at TEXT,
  created_at TEXT,
  location TEXT,
  lat REAL,
  lon REAL,
  camera TEXT,
  lens TEXT,
  iso INTEGER,
  shutter TEXT,
  aperture TEXT,
  focal_length TEXT,
  verdict TEXT NOT NULL DEFAULT 'unrated',
  stars INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  sharpness REAL,
  quality REAL,
  burst_id TEXT,
  tags TEXT,
  caption TEXT,
  bytes_original INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_shots_verdict ON shots(verdict);
CREATE INDEX IF NOT EXISTS idx_shots_status ON shots(original_status);
CREATE INDEX IF NOT EXISTS idx_shots_burst ON shots(burst_id);
"""


class Catalog:
    def __init__(self, library: Path):
        self.library = Path(library).expanduser().resolve()
        self.previews = self.library / "previews"
        self.db_path = self.library / "catalog.sqlite"
        self.library.mkdir(parents=True, exist_ok=True)
        self.previews.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def get(self, shot_id: str) -> Shot | None:
        row = self.conn.execute("SELECT * FROM shots WHERE id = ?", (shot_id,)).fetchone()
        return Shot.from_row(row) if row else None

    def by_original(self, path: str) -> Shot | None:
        row = self.conn.execute(
            "SELECT * FROM shots WHERE original_path = ?", (str(Path(path).resolve()),)
        ).fetchone()
        return Shot.from_row(row) if row else None

    def list(self, **where: str) -> list[Shot]:
        sql = "SELECT * FROM shots"
        params: list[object] = []
        clauses: list[str] = []
        for k, v in where.items():
            clauses.append(f"{k} = ?")
            params.append(v)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY captured_at DESC, id"
        return [Shot.from_row(r) for r in self.conn.execute(sql, params)]

    def upsert(self, shot: Shot) -> None:
        cols = list(shot.to_row().keys())
        placeholders = ",".join("?" for _ in cols)
        assignments = ",".join(f"{c}=excluded.{c}" for c in cols if c != "id")
        sql = f"INSERT INTO shots ({','.join(cols)}) VALUES ({placeholders}) ON CONFLICT(id) DO UPDATE SET {assignments}"
        self.conn.execute(sql, [shot.to_row()[c] for c in cols])
        self.conn.commit()

    def update(self, shot_id: str, **fields: object) -> Shot | None:
        if not fields:
            return self.get(shot_id)
        assignments = ",".join(f"{k} = ?" for k in fields)
        self.conn.execute(f"UPDATE shots SET {assignments} WHERE id = ?", [*fields.values(), shot_id])
        self.conn.commit()
        return self.get(shot_id)

    def preview_file(self, shot_id: str) -> Path:
        return self.previews / f"{shot_id}.jpg"
