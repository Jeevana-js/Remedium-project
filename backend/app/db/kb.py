"""KB article store, persisted to disk so it survives backend restarts.

Mirrors app.db.cases / app.db.users / app.db.ado_connections (JSON file, atomic writes).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.models.kb import KBArticle

DB_PATH = Path(__file__).parent / "kb_articles.json"


def _load_raw() -> dict[str, dict]:
    if not DB_PATH.exists():
        return {}
    with open(DB_PATH) as f:
        return json.load(f)


def _save_raw(articles: dict[str, dict]) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = DB_PATH.with_suffix(".json.tmp")
    with open(tmp_path, "w") as f:
        json.dump(articles, f, indent=2, default=str)
    os.replace(tmp_path, DB_PATH)


def load_all() -> list[KBArticle]:
    return [KBArticle.model_validate(data) for data in _load_raw().values()]


def get_article(article_id: str) -> KBArticle | None:
    raw = _load_raw().get(article_id)
    return KBArticle.model_validate(raw) if raw else None


def save_article(article: KBArticle) -> None:
    articles = _load_raw()
    articles[str(article.id)] = article.model_dump(mode="json")
    _save_raw(articles)


def delete_article(article_id: str) -> None:
    articles = _load_raw()
    articles.pop(article_id, None)
    _save_raw(articles)
