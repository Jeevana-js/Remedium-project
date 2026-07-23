"""Case store, persisted to disk so it survives backend restarts.

Mirrors app.db.users / app.db.ado_connections (JSON file, atomic writes).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.models.case import Case

DB_PATH = Path(__file__).parent / "cases.json"


def _load_raw() -> dict[str, dict]:
    if not DB_PATH.exists():
        return {}
    with open(DB_PATH) as f:
        return json.load(f)


def _save_raw(cases: dict[str, dict]) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = DB_PATH.with_suffix(".json.tmp")
    with open(tmp_path, "w") as f:
        json.dump(cases, f, indent=2, default=str)
    os.replace(tmp_path, DB_PATH)


def load_all() -> dict[str, Case]:
    return {cid: Case.model_validate(data) for cid, data in _load_raw().items()}


def save_case(case: Case) -> None:
    cases = _load_raw()
    cases[str(case.id)] = case.model_dump(mode="json")
    _save_raw(cases)


def delete_case(case_id: str) -> None:
    cases = _load_raw()
    cases.pop(case_id, None)
    _save_raw(cases)
