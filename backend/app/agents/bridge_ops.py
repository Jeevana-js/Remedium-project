"""
BridgeOps Agent — WorkItem Synthesizer.

1. Embed all input cases.
2. Cluster by cosine similarity.
3. For each cluster, check if an ADO work item already exists (semantic dedup).
4. Either link the case to the existing item or draft a new repro-complete ADO item.
"""
from __future__ import annotations

import json
from typing import Any

import structlog
from sklearn.cluster import AgglomerativeClustering  # type: ignore
import numpy as np

from app.agents.base import chat
from app.connectors.ado_client import search_work_items
from app.models.work_item import (
    CaseCluster,
    WorkItemDraft,
    WorkItemSeverity,
    WorkItemSynthesisResult,
    WorkItemType,
)
from app.retrieval.embeddings import embed_batch

log = structlog.get_logger()

DRAFT_SCHEMA = {
    "name": "work_item_draft",
    "description": "Draft a repro-complete ADO work item",
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "severity": {"type": "string", "enum": [s.value for s in WorkItemSeverity]},
            "area_path": {"type": "string"},
            "description": {"type": "string"},
            "repro_steps": {"type": "array", "items": {"type": "string"}},
            "acceptance_criteria": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": ["title", "severity", "description", "repro_steps", "confidence"],
    },
}

SYSTEM_PROMPT = """You are BridgeOps, an Azure DevOps work item author.
Given a cluster of similar customer cases, write a clean, repro-complete Bug work item.
Include: title, severity, description (with customer impact count), numbered repro steps,
and acceptance criteria for the fix. Be precise and technical."""


async def _cluster_cases(
    cases: list[dict[str, str]],
    distance_threshold: float = 0.35,
) -> list[list[int]]:
    texts = [f"{c['title']} {c['description']}" for c in cases]
    vectors = await embed_batch(texts)
    matrix = np.array(vectors)

    if len(matrix) < 2:
        return [list(range(len(cases)))]

    # Cosine distance = 1 - cosine similarity
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    normed = matrix / (norms + 1e-9)
    dist_matrix = 1.0 - normed @ normed.T

    clustering = AgglomerativeClustering(
        n_clusters=None,
        distance_threshold=distance_threshold,
        metric="precomputed",
        linkage="average",
    )
    labels = clustering.fit_predict(dist_matrix)

    clusters: dict[int, list[int]] = {}
    for i, label in enumerate(labels):
        clusters.setdefault(int(label), []).append(i)
    return list(clusters.values())


async def run(
    cases: list[dict[str, str]],
) -> WorkItemSynthesisResult:
    log.info("bridge_ops.start", case_count=len(cases))

    cluster_groups = await _cluster_cases(cases)
    log.info("bridge_ops.clustered", cluster_count=len(cluster_groups))

    drafts: list[WorkItemDraft] = []
    case_clusters: list[CaseCluster] = []
    linked_existing = 0
    new_items = 0

    for group in cluster_groups:
        group_cases = [cases[i] for i in group]
        centroid_title = max(group_cases, key=lambda c: len(c["title"]))["title"]

        # Check ADO for existing matching items
        existing = await search_work_items(centroid_title, top=3)
        existing_id: str | None = None
        if existing:
            # Simple heuristic: first result is the dedup candidate
            existing_id = str(existing[0]["id"])
            linked_existing += 1

        cluster = CaseCluster(
            case_ids=[c.get("id", str(i)) for i, c in zip(group, group_cases)],
            centroid_title=centroid_title,
            common_symptoms=[c["title"] for c in group_cases[:3]],
            customer_count=len(group_cases),
            suggested_severity=_severity_from_count(len(group_cases)),
        )
        case_clusters.append(cluster)

        if existing_id:
            # Link to existing, no new item needed
            drafts.append(
                WorkItemDraft(
                    title=centroid_title,
                    type=WorkItemType.BUG,
                    severity=cluster.suggested_severity,
                    description="Linked to existing work item.",
                    repro_steps=[],
                    customer_impact_count=len(group_cases),
                    linked_case_ids=cluster.case_ids,
                    existing_ado_id=existing_id,
                    confidence=0.85,
                )
            )
            continue

        # Draft new work item via LLM
        cases_summary = "\n".join(
            f"- Case {i+1}: {c['title']}: {c['description'][:200]}"
            for i, c in enumerate(group_cases)
        )
        response = await chat(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"{len(group_cases)} customers affected.\n\n"
                        f"Cases:\n{cases_summary}"
                    ),
                },
            ],
            tools=[{"type": "function", "function": DRAFT_SCHEMA}],
        )

        msg = response.choices[0].message
        if msg.tool_calls:
            data = json.loads(msg.tool_calls[0].function.arguments)
        else:
            data = json.loads(msg.content or "{}")

        draft = WorkItemDraft(
            title=data["title"],
            type=WorkItemType.BUG,
            severity=WorkItemSeverity(data["severity"]),
            area_path=data.get("area_path"),
            description=data["description"],
            repro_steps=data["repro_steps"],
            acceptance_criteria=data.get("acceptance_criteria"),
            customer_impact_count=len(group_cases),
            linked_case_ids=cluster.case_ids,
            confidence=float(data["confidence"]),
        )
        drafts.append(draft)
        new_items += 1

    log.info("bridge_ops.done", linked=linked_existing, new=new_items)
    return WorkItemSynthesisResult(
        clusters=case_clusters,
        drafts=drafts,
        linked_existing=linked_existing,
        new_items=new_items,
    )


def _severity_from_count(count: int) -> WorkItemSeverity:
    if count >= 10:
        return WorkItemSeverity.CRITICAL
    if count >= 5:
        return WorkItemSeverity.HIGH
    if count >= 2:
        return WorkItemSeverity.MEDIUM
    return WorkItemSeverity.LOW
