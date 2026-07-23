"""In-memory vector store — no Qdrant required."""
from __future__ import annotations

from typing import Any

import numpy as np
import structlog

from app.retrieval.embeddings import embed

log = structlog.get_logger()

# collection_name -> list of {id, vector, payload}
_store: dict[str, list[dict[str, Any]]] = {
    "kb_articles": [],
    "past_cases": [],
    "rca_docs": [],
    "ado_items": [],
}


async def ensure_collections() -> None:
    pass  # nothing to create for in-memory store


async def upsert(
    collection: str,
    doc_id: str,
    text: str,
    payload: dict[str, Any],
) -> None:
    vector = await embed(text)
    col = _store.setdefault(collection, [])
    for item in col:
        if item["id"] == doc_id:
            item["vector"] = vector
            item["payload"] = payload
            return
    col.append({"id": doc_id, "vector": vector, "payload": payload})


async def search(
    collection: str,
    query: str,
    top_k: int = 5,
    filter_payload: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    col = _store.get(collection, [])
    if not col:
        return []

    query_vec = np.array(await embed(query))
    scores: list[tuple[float, dict]] = []

    for item in col:
        if filter_payload:
            if not all(item["payload"].get(k) == v for k, v in filter_payload.items()):
                continue
        vec = np.array(item["vector"])
        norm = np.linalg.norm(query_vec) * np.linalg.norm(vec)
        score = float(np.dot(query_vec, vec) / norm) if norm > 0 else 0.0
        scores.append((score, item))

    scores.sort(key=lambda x: x[0], reverse=True)
    return [
        {"id": item["id"], "score": score, **item["payload"]}
        for score, item in scores[:top_k]
    ]
