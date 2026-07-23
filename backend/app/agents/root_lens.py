"""
RootLens Agent — RCA / REA Co-pilot.

Given an incident ID, pulls:
- Recent code commits from ADO
- Log/telemetry excerpts
- Similar past RCAs from vector store

Produces a structured RCA draft: timeline, 5-whys, contributing factors,
preventive actions, and a "we've seen this before" callout.
"""
from __future__ import annotations

import json
from datetime import datetime

import structlog

from app.agents.base import chat
from app.connectors.ado_client import get_recent_commits
from app.models.rca import FiveWhy, RCADraft, SimilarIncident, TimelineEvent
from app.retrieval.vector_store import search

log = structlog.get_logger()

RCA_SCHEMA = {
    "name": "rca_draft",
    "description": "Structured RCA/REA document",
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "summary": {"type": "string"},
            "timeline": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "timestamp": {"type": "string"},
                        "description": {"type": "string"},
                        "source": {"type": "string"},
                    },
                },
            },
            "five_whys": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "level": {"type": "integer"},
                        "why": {"type": "string"},
                        "answer": {"type": "string"},
                    },
                },
            },
            "contributing_factors": {"type": "array", "items": {"type": "string"}},
            "preventive_actions": {"type": "array", "items": {"type": "string"}},
            "confidence": {"type": "number"},
        },
        "required": [
            "title", "summary", "timeline", "five_whys",
            "contributing_factors", "preventive_actions", "confidence",
        ],
    },
}

SYSTEM_PROMPT = """You are RootLens, a root-cause analysis specialist.
Given incident details, recent code commits, log excerpts, and past similar incidents,
produce a rigorous RCA/REA document:
- An accurate timeline of events
- A 5-why causal chain reaching the root cause
- 3-5 contributing factors
- 3-5 concrete, actionable preventive measures
Cite specific commits, log lines, or past incidents by ID where relevant."""


async def run(
    incident_id: str,
    incident_title: str,
    incident_description: str,
    log_excerpts: list[str] | None = None,
) -> RCADraft:
    log.info("root_lens.start", incident_id=incident_id)

    # Retrieve similar past RCAs
    similar_hits = await search("rca_docs", incident_title, top_k=3)
    similar_incidents = [
        SimilarIncident(
            rca_id=h["id"],
            title=h.get("title", "Past incident"),
            date=datetime.fromisoformat(h.get("date", "2024-01-01")),
            similarity_score=h["score"],
            key_pattern=h.get("key_pattern", ""),
        )
        for h in similar_hits
    ]

    # Fetch recent commits from ADO
    commits = await get_recent_commits(days=7)
    commits_summary = "\n".join(
        f"- [{c.get('commitId', '')[:8]}] {c.get('comment', '')[:120]}"
        for c in commits[:10]
    )

    logs_text = "\n".join((log_excerpts or [])[:5])
    similar_text = "\n".join(
        f"- [{s.rca_id}] {s.title} (similarity: {s.similarity_score:.2f}): {s.key_pattern}"
        for s in similar_incidents
    )

    response = await chat(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"## Incident\n**ID:** {incident_id}\n"
                    f"**Title:** {incident_title}\n"
                    f"**Description:** {incident_description}\n\n"
                    f"## Recent Code Changes (last 7 days)\n{commits_summary or 'None available'}\n\n"
                    f"## Log Excerpts\n{logs_text or 'None provided'}\n\n"
                    f"## Similar Past Incidents\n{similar_text or 'None found'}"
                ),
            },
        ],
        tools=[{"type": "function", "function": RCA_SCHEMA}],
    )

    msg = response.choices[0].message
    if msg.tool_calls:
        data = json.loads(msg.tool_calls[0].function.arguments)
    else:
        data = json.loads(msg.content or "{}")

    timeline = [
        TimelineEvent(
            timestamp=datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00")),
            description=e["description"],
            source=e["source"],
        )
        for e in data.get("timeline", [])
    ]
    five_whys = [
        FiveWhy(level=w["level"], why=w["why"], answer=w["answer"])
        for w in data.get("five_whys", [])
    ]

    rca = RCADraft(
        incident_id=incident_id,
        title=data["title"],
        summary=data["summary"],
        timeline=timeline,
        five_whys=five_whys,
        contributing_factors=data.get("contributing_factors", []),
        preventive_actions=data.get("preventive_actions", []),
        similar_incidents=similar_incidents,
        confidence=float(data.get("confidence", 0.7)),
    )

    log.info("root_lens.done", incident_id=incident_id, confidence=rca.confidence)
    return rca
