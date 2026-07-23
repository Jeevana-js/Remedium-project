"""Unified retriever: hybrid search across KB, cases, ADO, RCA docs."""
from __future__ import annotations

import asyncio
from typing import Any

import structlog

from app.models.case import CaseSource
from app.retrieval.vector_store import search

log = structlog.get_logger()


async def retrieve_for_case(
    query: str,
    product: str | None = None,
    top_k: int = 5,
) -> list[CaseSource]:
    """Parallel search across all knowledge sources; returns reranked sources."""
    filter_payload = {"product": product} if product else None

    kb_hits, case_hits, ado_hits, rca_hits = await asyncio.gather(
        search("kb_articles", query, top_k, filter_payload),
        search("past_cases", query, top_k, filter_payload),
        search("ado_items", query, top_k, filter_payload),
        search("rca_docs", query, top_k, filter_payload),
    )

    sources: list[CaseSource] = []

    def _to_sources(hits: list[dict], source_type: str) -> list[CaseSource]:
        return [
            CaseSource(
                id=h["id"],
                title=h.get("title", "Untitled"),
                url=h.get("url"),
                excerpt=h.get("excerpt", h.get("content", "")[:300]),
                relevance_score=round(h["score"], 4),
                source_type=source_type,
            )
            for h in hits
        ]

    sources.extend(_to_sources(kb_hits, "kb_article"))
    sources.extend(_to_sources(case_hits, "past_case"))
    sources.extend(_to_sources(ado_hits, "ado_item"))
    sources.extend(_to_sources(rca_hits, "rca_doc"))

    # Sort by relevance descending, return top_k * 2 for agent to use
    sources.sort(key=lambda s: s.relevance_score, reverse=True)
    return sources[: top_k * 2]
