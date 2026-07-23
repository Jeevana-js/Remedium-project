"""Simple JSON file-based user store with bcrypt password hashing."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

DB_PATH = Path(__file__).parent / "users.json"

# Seed default users on first run
_DEFAULT_USERS = [
    {"name": "Jeevana Sakthi", "email": "jeevana@aptean.com",  "password_hash": ""},
    {"name": "Admin",          "email": "admin@aptean.com",    "password_hash": ""},
]
_DEFAULT_PASSWORDS = {
    "jeevana@aptean.com": "Aptean@2024",
    "admin@aptean.com":   "Remedium@123",
}


def _hash(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _load() -> list[dict]:
    if not DB_PATH.exists():
        # Seed defaults
        users = []
        for u in _DEFAULT_USERS:
            users.append({
                "name": u["name"],
                "email": u["email"],
                "password_hash": _hash(_DEFAULT_PASSWORDS[u["email"]]),
            })
        _save(users)
        return users
    with open(DB_PATH) as f:
        return json.load(f)


def _save(users: list[dict]) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Write to a temp file and rename so a crash mid-write (e.g. two backend
    # processes racing on the same port) can never truncate or lose the file.
    tmp_path = DB_PATH.with_suffix(".json.tmp")
    with open(tmp_path, "w") as f:
        json.dump(users, f, indent=2)
    os.replace(tmp_path, DB_PATH)


def get_user(email: str) -> dict | None:
    users = _load()
    email_lower = email.lower()
    return next((u for u in users if u["email"].lower() == email_lower), None)


def create_user(name: str, email: str, password: str) -> dict | None:
    """Returns None if email already exists."""
    users = _load()
    if any(u["email"].lower() == email.lower() for u in users):
        return None
    new_user = {"name": name, "email": email.lower(), "password_hash": _hash(password)}
    users.append(new_user)
    _save(users)
    return new_user


def verify_user(email: str, password: str) -> dict | None:
    """Returns user dict if credentials are valid, else None."""
    user = get_user(email)
    if not user:
        return None
    if user["password_hash"] != _hash(password):
        return None
    return user
