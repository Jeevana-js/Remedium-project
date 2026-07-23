"""Azure DevOps connections, cached in memory and backed by disk.

A user connects by POSTing org/project/team/PAT to /api/ado/connect. The
server validates it against the live ADO API, persists it (PAT encrypted)
in app.db.ado_connections keyed by the user's email, and caches it here in
memory keyed by session id = the user's email — sent back as the
X-Ado-Session header on subsequent requests.

Restart-safe: if a session isn't in the in-memory cache (e.g. after a
backend restart), get_session() transparently reloads it from disk.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.db import ado_connections


@dataclass
class AdoConnection:
    organization: str
    project: str
    team: str
    pat: str


_sessions: dict[str, AdoConnection] = {}


def create_session(user_email: str, conn: AdoConnection) -> str:
    session_id = user_email.lower()
    _sessions[session_id] = conn
    ado_connections.save_connection(
        user_email=session_id,
        organization=conn.organization,
        project=conn.project,
        team=conn.team,
        pat=conn.pat,
    )
    return session_id


def get_session(session_id: str | None) -> AdoConnection | None:
    if not session_id:
        return None
    cached = _sessions.get(session_id)
    if cached is not None:
        return cached

    record = ado_connections.get_connection(session_id)
    if record is None:
        return None
    conn = AdoConnection(**record)
    _sessions[session_id] = conn
    return conn


def drop_session(session_id: str | None) -> None:
    if session_id:
        _sessions.pop(session_id, None)
        ado_connections.delete_connection(session_id)
