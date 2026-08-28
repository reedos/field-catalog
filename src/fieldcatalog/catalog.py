from __future__ import annotations

import json
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
  bytes_original INTEGER NOT NULL DEFAULT 0,
  confidence REAL,
  field_marks TEXT,
  similar_species TEXT,
  notes TEXT,
  gps_from_file INTEGER NOT NULL DEFAULT 0,
  preview_width INTEGER,
  preview_height INTEGER
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
        # The UI spawns one process per call, so a list can land mid-import.
        # WAL lets the reader through; busy_timeout absorbs the rest.
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA busy_timeout=5000")
        self.conn.executescript(SCHEMA)
        self._migrate()
        self.conn.commit()

    def _migrate(self) -> None:
        cols = {r[1] for r in self.conn.execute("PRAGMA table_info(shots)")}
        added = False
        if "confidence" not in cols:
            self.conn.execute("ALTER TABLE shots ADD COLUMN confidence REAL")
            added = True
        if "field_marks" not in cols:
            self.conn.execute("ALTER TABLE shots ADD COLUMN field_marks TEXT")
            added = True
        if "gps_from_file" not in cols:
            self.conn.execute("ALTER TABLE shots ADD COLUMN gps_from_file INTEGER NOT NULL DEFAULT 0")
            self.conn.execute(
                "UPDATE shots SET gps_from_file = 1 WHERE lat IS NOT NULL AND lon IS NOT NULL"
            )
            added = True
        if "similar_species" not in cols:
            self.conn.execute("ALTER TABLE shots ADD COLUMN similar_species TEXT")
            added = True
        if "notes" not in cols:
            self.conn.execute("ALTER TABLE shots ADD COLUMN notes TEXT")
            added = True
        # Lets the grid lay out before any thumbnail has decoded.
        for col in ("preview_width", "preview_height"):
            if col not in cols:
                self.conn.execute(f"ALTER TABLE shots ADD COLUMN {col} INTEGER")
                added = True
        # list() orders by captured_at DESC on every library load.
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_shots_captured ON shots(captured_at DESC)"
        )
        if added:
            self.conn.commit()


    def distinct_field_marks(self, limit: int = 200) -> list[str]:
        marks = set()
        for row in self.conn.execute("SELECT field_marks FROM shots WHERE field_marks IS NOT NULL"):
            fm = row["field_marks"]
            if not fm:
                continue
            try:
                arr = json.loads(fm)
                if isinstance(arr, list):
                    marks.update([str(x) for x in arr])
                else:
                    marks.update([str(fm)])
            except Exception:
                # comma separated
                for part in fm.split(","):
                    marks.add(part.strip())
        marks.discard("")
        return sorted(marks)[:limit]

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

    def _where(self, where: dict) -> tuple[str, list[object]]:
        if not where:
            return "", []
        return " WHERE " + " AND ".join(f"{k} = ?" for k in where), list(where.values())

    def list(self, limit: int | None = None, **where: str) -> list[Shot]:
        clause, params = self._where(where)
        sql = f"SELECT * FROM shots{clause} ORDER BY captured_at DESC, id"
        if limit:
            sql += " LIMIT ?"
            params = [*params, limit]
        return [Shot.from_row(r) for r in self.conn.execute(sql, params)]

    def counts(self, **where: str) -> tuple[int, dict[str, int], dict[str, int]]:
        """Totals by verdict and original_status without building any Shot."""
        clause, params = self._where(where)
        verdicts: dict[str, int] = {}
        statuses: dict[str, int] = {}
        total = 0
        for col, sink in (("verdict", verdicts), ("original_status", statuses)):
            for row in self.conn.execute(
                f"SELECT {col} AS k, COUNT(*) AS n FROM shots{clause} GROUP BY {col}", params
            ):
                sink[row["k"]] = row["n"]
        total = sum(verdicts.values())
        return total, verdicts, statuses

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

    def update_many(self, ids: list[str], **fields: object) -> int:
        """Apply the same field values to many rows in one transaction."""
        if not ids or not fields:
            return 0
        assignments = ",".join(f"{k} = ?" for k in fields)
        self.conn.executemany(
            f"UPDATE shots SET {assignments} WHERE id = ?",
            [[*fields.values(), shot_id] for shot_id in ids],
        )
        self.conn.commit()
        return len(ids)

    def set_burst_ids(self, pairs: list[tuple[str, str]]) -> int:
        """Write many burst ids in one transaction. Returns the number of rows written."""
        if not pairs:
            return 0
        self.conn.executemany(
            "UPDATE shots SET burst_id = ? WHERE id = ?",
            [(burst_id, shot_id) for shot_id, burst_id in pairs],
        )
        self.conn.commit()
        return len(pairs)

    def preview_file(self, shot_id: str) -> Path:
        return self.previews / f"{shot_id}.jpg"
