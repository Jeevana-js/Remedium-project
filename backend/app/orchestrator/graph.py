"""
Remedium Orchestrator — LangGraph 1.x state machine.
"""
from __future__ import annotations

from typing import Any, Optional

import structlog
from langgraph.graph import END, StateGraph
from typing_extensions import TypedDict

from app.agents import bridge_ops, case_intelligence, live_kb, test_forge
from app.db import kb as kb_db
from app.models.case import CaseCategory, CaseIngest, CasePacket, CaseStatus
from app.models.test_generation import TestFramework

log = structlog.get_logger()

CONFIDENCE_THRESHOLD = 0.6


class OrchestratorState(TypedDict, total=False):
    case: CaseIngest
    case_id: str
    status: str
    packet: Optional[CasePacket]
    work_item_result: Optional[Any]
    generated_test: Optional[Any]
    kb_article: Optional[Any]
    error: Optional[str]
    approved: bool


async def node_intake(state: OrchestratorState) -> dict:
    log.info("orchestrator.intake", case_title=state["case"].title)
    return {"status": CaseStatus.ANALYSING.value}


async def node_analyse(state: OrchestratorState) -> dict:
    log.info("orchestrator.analyse")
    try:
        packet = await case_intelligence.run(state["case"])
        return {"packet": packet, "status": CaseStatus.PENDING_APPROVAL.value}
    except Exception as exc:
        log.error("orchestrator.analyse.error", error=str(exc))
        return {"error": str(exc), "status": CaseStatus.ESCALATED.value}


def route_after_analyse(state: OrchestratorState) -> str:
    if state.get("error"):
        return "escalate"
    packet = state.get("packet")
    if packet and packet.confidence < CONFIDENCE_THRESHOLD:
        return "escalate"
    if packet and packet.category == CaseCategory.KNOWN_ISSUE:
        return "auto_close"
    return "pending_approval"


async def node_escalate(state: OrchestratorState) -> dict:
    log.info("orchestrator.escalate", reason=state.get("error", "low confidence"))
    return {"status": CaseStatus.ESCALATED.value}


async def node_auto_close(state: OrchestratorState) -> dict:
    log.info("orchestrator.auto_close", case_title=state["case"].title)
    return {"status": CaseStatus.RESOLVED.value}


async def node_pending_approval(state: OrchestratorState) -> dict:
    return {"status": CaseStatus.PENDING_APPROVAL.value}


def route_after_approval(state: OrchestratorState) -> str:
    if state.get("approved"):
        return "act"
    return END


async def node_act(state: OrchestratorState) -> dict:
    updates: dict = {}
    packet = state.get("packet")
    if not packet:
        return updates

    if packet.category == CaseCategory.CONFIRMED_BUG:
        try:
            wi_result = await bridge_ops.run(
                cases=[{"id": state.get("case_id", ""), "title": state["case"].title, "description": state["case"].description}]
            )
            updates["work_item_result"] = wi_result
        except Exception as exc:
            log.warning("orchestrator.act.bridge_ops.error", error=str(exc))

        try:
            test = await test_forge.generate_test(
                bug_title=state["case"].title,
                bug_description=state["case"].description,
                fix_description=packet.diagnosis,
                framework=TestFramework.PYTEST,
                case_id=state.get("case_id", ""),
            )
            updates["generated_test"] = test
        except Exception as exc:
            log.warning("orchestrator.act.test_forge.error", error=str(exc))

    updates["status"] = CaseStatus.RESOLVED.value
    return updates


async def node_learn(state: OrchestratorState) -> dict:
    """Draft a KB article from a newly-resolved case not already covered by one,
    persist it, and index it so future tickets can match against it."""
    packet = state.get("packet")
    if not packet:
        return {}
    try:
        article = await live_kb.draft_article_for_case(
            case_title=state["case"].title,
            case_description=state["case"].description,
            resolution_steps=packet.resolution_steps,
            diagnosis=packet.diagnosis,
            product=state["case"].product,
        )
        kb_db.save_article(article)
        from app.api.routes.kb import _index_article
        await _index_article(article)
        return {"kb_article": article}
    except Exception as exc:
        log.warning("orchestrator.learn.error", error=str(exc))
        return {}


async def run_post_approval(case_id: str, case: CaseIngest, packet: CasePacket) -> dict:
    """Act + learn logic for a manually-approved case.

    The LangGraph run that produced `packet` already finished before a human ever
    saw the approval gate, so there is no in-flight graph execution to resume —
    this reimplements node_act + node_learn directly against the approved case.
    """
    updates: dict = {}

    if packet.category == CaseCategory.CONFIRMED_BUG:
        try:
            wi_result = await bridge_ops.run(
                cases=[{"id": case_id, "title": case.title, "description": case.description}]
            )
            updates["work_item_result"] = wi_result
        except Exception as exc:
            log.warning("orchestrator.post_approval.bridge_ops.error", error=str(exc))

        try:
            test = await test_forge.generate_test(
                bug_title=case.title,
                bug_description=case.description,
                fix_description=packet.diagnosis,
                framework=TestFramework.PYTEST,
                case_id=case_id,
            )
            updates["generated_test"] = test
        except Exception as exc:
            log.warning("orchestrator.post_approval.test_forge.error", error=str(exc))

    try:
        article = await live_kb.draft_article_for_case(
            case_title=case.title,
            case_description=case.description,
            resolution_steps=packet.resolution_steps,
            diagnosis=packet.diagnosis,
            product=case.product,
        )
        kb_db.save_article(article)
        from app.api.routes.kb import _index_article
        await _index_article(article)
        updates["kb_article"] = article
    except Exception as exc:
        log.warning("orchestrator.post_approval.learn.error", error=str(exc))

    return updates


def build_graph():
    graph = StateGraph(OrchestratorState)

    graph.add_node("intake", node_intake)
    graph.add_node("analyse", node_analyse)
    graph.add_node("escalate", node_escalate)
    graph.add_node("auto_close", node_auto_close)
    graph.add_node("pending_approval", node_pending_approval)
    graph.add_node("act", node_act)
    graph.add_node("learn", node_learn)

    graph.set_entry_point("intake")
    graph.add_edge("intake", "analyse")
    graph.add_conditional_edges(
        "analyse",
        route_after_analyse,
        {"escalate": "escalate", "auto_close": "auto_close", "pending_approval": "pending_approval"},
    )
    graph.add_conditional_edges(
        "pending_approval",
        route_after_approval,
        {"act": "act", END: END},
    )
    graph.add_edge("act", "learn")
    graph.add_edge("learn", END)
    graph.add_edge("escalate", END)
    graph.add_edge("auto_close", END)

    return graph.compile()


remedium_graph = build_graph()
