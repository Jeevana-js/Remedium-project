"""Per-user Azure DevOps connections, persisted to disk with the PAT encrypted.

Mirrors app.db.users (JSON file, atomic writes). Keyed by the user's email so
each account has exactly one saved board connection, and it survives backend
restarts — unlike app.state.ado_sessions, which only lives in memory.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

DB_PATH = Path(__file__).parent / "ado_connections.json"


def _fernet() -> Fernet:
    # Derive a valid 32-byte urlsafe-base64 Fernet key from SECRET_KEY so no
    # extra config is needed.
    digest = hashlib.sha256(settings.secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _load() -> dict[str, dict]:
    if not DB_PATH.exists():
        return {}
    with open(DB_PATH) as f:
        return json.load(f)


def _save(connections: dict[str, dict]) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = DB_PATH.with_suffix(".json.tmp")
    with open(tmp_path, "w") as f:
        json.dump(connections, f, indent=2)
    os.replace(tmp_path, DB_PATH)


def save_connection(user_email: str, organization: str, project: str, team: str, pat: str) -> None:
    connections = _load()
    connections[user_email.lower()] = {
        "organization": organization,
        "project": project,
        "team": team,
        "pat_encrypted": _fernet().encrypt(pat.encode()).decode(),
    }
    _save(connections)


def get_connection(user_email: str) -> dict | None:
    """Returns {organization, project, team, pat} or None if not connected / undecryptable."""
    connections = _load()
    record = connections.get(user_email.lower())
    if record is None:
        return None
    try:
        pat = _fernet().decrypt(record["pat_encrypted"].encode()).decode()
    except InvalidToken:
        return None
    return {
        "organization": record["organization"],
        "project": record["project"],
        "team": record["team"],
        "pat": pat,
    }


def delete_connection(user_email: str) -> None:
    connections = _load()
    connections.pop(user_email.lower(), None)
    _save(connections)
