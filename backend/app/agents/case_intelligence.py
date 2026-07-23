"""
Case Intelligence Agent — Resolve module.

ReAct loop: perceive case → retrieve sources → classify → diagnose → draft reply.
Returns a CasePacket with confidence score and cited sources.
"""
from __future__ import annotations

import json
from typing import AsyncIterator

import structlog

from app.agents.base import chat
from app.models.case import CaseCategory, CaseIngest, CasePacket, CaseSource
from app.retrieval.retriever import retrieve_for_case

log = structlog.get_logger()

SYSTEM_PROMPT = """You are Case Intelligence, a specialist support-engineering AI.

Your job:
1. Check first whether a retrieved kb_article or past_case source already documents this
   exact problem and resolution. If one does, classify as known_issue, open the diagnosis
   by stating plainly that this is already solved/documented (name which source, e.g.
   "Already documented in [src-2]"), and base the resolution steps on that source instead
   of inventing new ones.
2. If no source covers it, classify as one of: configuration | confirmed_bug | feature_gap
   | unknown, and diagnose/resolve from scratch using whatever partial evidence exists.
3. Write a concise technical diagnosis (2-4 sentences) citing source IDs.
4. List 3-7 numbered resolution steps.
5. Draft a professional, empathetic customer-ready reply.
6. Return a confidence score (0.0–1.0) for your classification.

Rules:
- Only use information from the provided sources. Cite source IDs inline e.g. [src-3].
- If confidence < 0.6, say so and recommend human escalation.
- Keep the customer reply under 200 words.
- Respond ONLY with valid JSON matching the required schema.

Calibrating confidence:
- Do not default to a round number like 0.7 or 0.8. Compute it from the actual evidence.
- Weigh: how directly the retrieved sources address this exact symptom, whether multiple
  sources agree or conflict, how much of the diagnosis is inference versus cited fact, and
  how specific/unambiguous the case description is.
- Strong direct source match on an unambiguous case → 0.85-0.97.
- Partial or indirect source match, or some inference required → 0.5-0.75.
- Weak/no relevant sources, or a vague/ambiguous case → below 0.5.
- Use the full range with case-specific precision (e.g. 0.63, 0.88), not round multiples of 0.05.
"""

RESPONSE_SCHEMA = {
    "name": "case_packet",
    "description": "Full case resolution packet",
    "parameters": {
        "type": "object",
        "properties": {
            "category": {"type": "string", "enum": [c.value for c in CaseCategory]},
            "confidence": {"type": "number"},
            "diagnosis": {"type": "string"},
            "resolution_steps": {"type": "array", "items": {"type": "string"}},
            "customer_reply": {"type": "string"},
        },
        "required": ["category", "confidence", "diagnosis", "resolution_steps", "customer_reply"],
    },
}


def _format_sources(sources: list[CaseSource]) -> str:
    lines = []
    for i, s in enumerate(sources):
        lines.append(
            f"[src-{i+1}] ({s.source_type}) {s.title}\n"
            f"  Score: {s.relevance_score:.2f}\n"
            f"  Excerpt: {s.excerpt[:400]}"
        )
    return "\n\n".join(lines)


async def run(case: CaseIngest) -> CasePacket:
    log.info("case_intelligence.start", title=case.title)

    sources = await retrieve_for_case(
        query=f"{case.title}\n{case.description}",
        product=case.product,
    )

    sources_text = _format_sources(sources)
    user_message = (
        f"## Case\n**Title:** {case.title}\n**Description:**\n{case.description}\n"
        f"**Product:** {case.product or 'unknown'} v{case.version or 'unknown'}\n"
        f"**Priority:** {case.priority.value}\n\n"
        f"## Retrieved Sources\n{sources_text}"
    )

    response = await chat(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        tools=[{"type": "function", "function": RESPONSE_SCHEMA}],
    )

    msg = response.choices[0].message
    if msg.tool_calls:
        data = json.loads(msg.tool_calls[0].function.arguments)
    else:
        data = json.loads(msg.content or "{}")

    packet = CasePacket(
        category=CaseCategory(data["category"]),
        confidence=float(data["confidence"]),
        diagnosis=data["diagnosis"],
        resolution_steps=data["resolution_steps"],
        customer_reply=data["customer_reply"],
        sources=sources,
    )

    log.info(
        "case_intelligence.done",
        category=packet.category,
        confidence=packet.confidence,
        source_count=len(sources),
    )
    return packet


async def stream(case: CaseIngest) -> AsyncIterator[str]:
    """Streaming variant — yields SSE-compatible text chunks."""
    sources = await retrieve_for_case(
        query=f"{case.title}\n{case.description}",
        product=case.product,
    )
    sources_text = _format_sources(sources)
    user_message = (
        f"## Case\n**Title:** {case.title}\n**Description:**\n{case.description}\n\n"
        f"## Retrieved Sources\n{sources_text}\n\n"
        "Respond with the case packet JSON as described."
    )

    from app.agents.base import get_client
    from app.config import settings as _s
    stream = await get_client().chat.completions.create(
        model=_s.groq_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        temperature=0.2,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            yield delta
