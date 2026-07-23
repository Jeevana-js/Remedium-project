"""
LiveKB Agent — Self-maintaining knowledge base.

1. Scans all KB articles for staleness (age + low hit rate).
2. Detects coverage gaps (resolved cases with no matching KB article).
3. Finds contradictions between articles on the same topic.
4. Drafts new articles for gaps.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from uuid import uuid4

import structlog

from app.agents.base import chat
from app.models.kb import ArticleHealth, KBArticle, KBGap, KBHealthReport
from app.retrieval.vector_store import search

log = structlog.get_logger()

ARTICLE_SCHEMA = {
    "name": "kb_article",
    "description": "A new KB article drafted from a resolved case",
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "content": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "product": {"type": "string"},
        },
        "required": ["title", "content", "tags"],
    },
}

SYSTEM_PROMPT = """You are LiveKB, a technical writer.
Given a resolved support case, write a clear, concise KB article that will help
engineers resolve the same issue in the future. Structure: Problem, Root Cause,
Resolution Steps, Prevention. Keep it under 600 words."""


async def draft_article_for_case(
    case_title: str,
    case_description: str,
    resolution_steps: list[str],
    diagnosis: str,
    product: str | None = None,
) -> KBArticle:
    log.info("live_kb.draft_article", case_title=case_title)

    response = await chat(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"**Case:** {case_title}\n\n"
                    f"**Description:** {case_description}\n\n"
                    f"**Diagnosis:** {diagnosis}\n\n"
                    f"**Resolution:**\n"
                    + "\n".join(f"{i+1}. {s}" for i, s in enumerate(resolution_steps))
                ),
            },
        ],
        tools=[{"type": "function", "function": ARTICLE_SCHEMA}],
    )

    msg = response.choices[0].message
    if msg.tool_calls:
        data = json.loads(msg.tool_calls[0].function.arguments)
    else:
        data = json.loads(msg.content or "{}")

    return KBArticle(
        title=data["title"],
        content=data["content"],
        tags=data.get("tags", []),
        product=data.get("product", product),
        health=ArticleHealth.HEALTHY,
        freshness_score=1.0,
    )


async def analyse_health(articles: list[KBArticle]) -> KBHealthReport:
    """Score all articles for staleness and detect contradictions."""
    log.info("live_kb.analyse_health", count=len(articles))

    stale_threshold = datetime.utcnow() - timedelta(days=180)
    stale: list[KBArticle] = []
    contradiction_pairs: list[tuple[str, str]] = []

    for article in articles:
        if article.last_reviewed and article.last_reviewed < stale_threshold:
            article.health = ArticleHealth.STALE
            article.freshness_score = max(0.1, article.freshness_score - 0.3)
            stale.append(article)

    # Detect contradictions via embedding similarity on same-tag articles
    for i, a in enumerate(articles):
        for b in articles[i + 1:]:
            shared_tags = set(a.tags) & set(b.tags)
            if not shared_tags:
                continue
            hits = await search("kb_articles", a.title, top_k=3)
            for h in hits:
                if h["id"] == str(b.id) and h["score"] > 0.92:
                    contradiction_pairs.append((str(a.id), str(b.id)))
                    a.health = ArticleHealth.CONTRADICTS
                    b.health = ArticleHealth.CONTRADICTS
                    break

    healthy_count = sum(1 for a in articles if a.health == ArticleHealth.HEALTHY)

    return KBHealthReport(
        total_articles=len(articles),
        healthy=healthy_count,
        stale=len(stale),
        contradictions=len(contradiction_pairs),
        coverage_gaps=0,  # gaps detected separately via detect_gaps()
        gap_details=[],
        stale_articles=stale,
        contradiction_pairs=contradiction_pairs,
    )


async def detect_gaps(
    resolved_cases: list[dict[str, str]],
) -> list[KBGap]:
    """Find resolved cases that have no matching KB article."""
    gaps: list[KBGap] = []
    for case in resolved_cases:
        query = f"{case.get('title', '')} {case.get('description', '')}"
        hits = await search("kb_articles", query, top_k=1)
        if not hits or hits[0]["score"] < 0.75:
            gaps.append(
                KBGap(
                    description=f"No KB article covers: {case.get('title', '')}",
                    source_case_ids=[case.get("id", str(uuid4()))],
                    confidence=1.0 - (hits[0]["score"] if hits else 0.0),
                )
            )
    log.info("live_kb.gaps_detected", count=len(gaps))
    return gaps
