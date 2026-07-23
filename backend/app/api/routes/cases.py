"""Cases API — ingest, approve, and retrieve case packets."""
from __future__ import annotations

from uuid import uuid4

import structlog
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse

from app.agents import case_intelligence
from app.connectors.claude_cli import ClaudeCliError, run_claude_cli
from app.db import cases as cases_db
from app.models.case import (
    ApprovalAction,
    Case,
    CaseApproval,
    CaseIngest,
    CaseSource,
    CaseStatus,
)
from app.orchestrator.graph import OrchestratorState, remedium_graph, run_post_approval
from app.retrieval.vector_store import search as vector_search
from app.retrieval.vector_store import upsert as vector_upsert

router = APIRouter()
log = structlog.get_logger()


async def _index_resolved_case(case: Case) -> None:
    """Index a resolved case's diagnosis so future tickets can match against it."""
    if not case.packet:
        return
    text = f"{case.title}\n{case.packet.diagnosis}\n" + "\n".join(case.packet.resolution_steps)
    await vector_upsert(
        "past_cases",
        str(case.id),
        text,
        {
            "title": case.title,
            "excerpt": case.packet.diagnosis[:300],
            "product": case.product,
            "url": None,
        },
    )

# Cases persist to disk (see app.db.cases) so they survive backend restarts.
# Orchestration state is only needed while a case is actively being processed,
# so it stays in memory.
_cases: dict[str, Case] = cases_db.load_all()
_states: dict[str, OrchestratorState] = {}


@router.post("/", response_model=Case, status_code=201)
async def ingest_case(body: CaseIngest, background_tasks: BackgroundTasks):
    case = Case(id=uuid4(), **body.model_dump(), status=CaseStatus.INGESTED)
    _cases[str(case.id)] = case
    cases_db.save_case(case)

    async def _run():
        import structlog
        _log = structlog.get_logger()
        try:
            state: OrchestratorState = {"case": body, "case_id": str(case.id), "approved": False}
            result = await remedium_graph.ainvoke(state)
            _states[str(case.id)] = result
            status_val = result.get("status", "")
            from app.models.case import CaseStatus
            for s in CaseStatus:
                if s.value == status_val:
                    case.status = s
                    break
            packet = result.get("packet")
            if packet:
                case.packet = packet
                case.category = packet.category
        except Exception as exc:
            _log.error("cases.background_task.error", error=str(exc), case_id=str(case.id))
            case.status = CaseStatus.ESCALATED
        finally:
            cases_db.save_case(case)

    background_tasks.add_task(_run)
    return case


@router.get("/", response_model=list[Case])
async def list_cases():
    return list(_cases.values())


@router.get("/{case_id}", response_model=Case)
async def get_case(case_id: str):
    case = _cases.get(case_id)
    if not case:
        raise HTTPException(404, "Case not found")
    return case


@router.delete("/{case_id}", status_code=204)
async def delete_case(case_id: str):
    if case_id not in _cases:
        raise HTTPException(404, "Case not found")
    del _cases[case_id]
    _states.pop(case_id, None)
    cases_db.delete_case(case_id)


@router.post("/{case_id}/approve", response_model=Case)
async def approve_case(case_id: str, approval: CaseApproval):
    case = _cases.get(case_id)
    if not case:
        raise HTTPException(404, "Case not found")
    # _states only tracks a case's in-flight orchestrator run and is not persisted,
    # so it's empty for any case created before the last backend restart — approval
    # itself only needs the persisted Case, so treat state as optional.
    state = _states.get(case_id)

    if approval.action == ApprovalAction.APPROVE:
        if state is not None:
            state["approved"] = True
        case.status = CaseStatus.APPROVED
        if approval.edited_packet:
            case.packet = approval.edited_packet
    elif approval.action == ApprovalAction.REJECT:
        case.status = CaseStatus.ESCALATED
    elif approval.action == ApprovalAction.EDIT:
        if approval.edited_packet:
            case.packet = approval.edited_packet
        if state is not None:
            state["approved"] = True
        case.status = CaseStatus.APPROVED
    elif approval.action == ApprovalAction.ESCALATE:
        case.status = CaseStatus.ESCALATED
    elif approval.action == ApprovalAction.REVOKE:
        # Undo a prior approval: send the case back to the review queue. The
        # packet is kept intact so it can be re-reviewed and re-approved. Any
        # side effects already produced (ADO work item, generated test) are left
        # as-is — this only reopens the human approval gate.
        if state is not None:
            state["approved"] = False
        case.status = CaseStatus.PENDING_APPROVAL

    cases_db.save_case(case)

    if case.status == CaseStatus.APPROVED:
        await _index_resolved_case(case)
        if case.packet:
            ingest = CaseIngest(
                title=case.title,
                description=case.description,
                customer=case.customer,
                product=case.product,
                version=case.version,
                priority=case.priority,
            )
            try:
                post_approval = await run_post_approval(str(case.id), ingest, case.packet)
                work_item_result = post_approval.get("work_item_result")
                if work_item_result and getattr(work_item_result, "drafts", None):
                    case.packet.ado_item_id = (
                        work_item_result.drafts[0].existing_ado_id
                        or work_item_result.drafts[0].title
                    )
                generated_test = post_approval.get("generated_test")
                if generated_test:
                    case.packet.regression_test_snippet = generated_test.test_code
                case.status = CaseStatus.RESOLVED
                cases_db.save_case(case)
            except Exception as exc:
                import structlog
                structlog.get_logger().error("cases.approve.post_approval.error", error=str(exc), case_id=case_id)

    return case


@router.get("/{case_id}/research-kb", response_model=list[CaseSource])
async def research_kb(case_id: str):
    """Search the KB-articles collection only, to check whether this case is
    already covered by an existing article before offering to resolve it."""
    case = _cases.get(case_id)
    if not case:
        raise HTTPException(404, "Case not found")

    filter_payload = {"product": case.product} if case.product else None
    hits = await vector_search("kb_articles", f"{case.title}\n{case.description}", 5, filter_payload)
    return [
        CaseSource(
            id=h["id"],
            title=h.get("title", "Untitled"),
            url=h.get("url"),
            excerpt=h.get("excerpt", ""),
            relevance_score=round(h["score"], 4),
            source_type="kb_article",
        )
        for h in hits
    ]


def _build_resolution_prompt(case: Case) -> str:
    return (
        "You are a support engineering assistant. Analyse the following customer "
        "case and draft a resolution write-up. Do not edit any files or run any "
        "tools — respond with text only.\n\n"
        f"Title: {case.title}\n"
        f"Product: {case.product or 'unknown'}\n"
        f"Version: {case.version or 'unknown'}\n"
        f"Description:\n{case.description}\n\n"
        "Provide: (1) a likely root cause, (2) concrete resolution steps, "
        "(3) a suggested customer-facing reply."
    )


@router.post("/{case_id}/resolve", response_model=Case, status_code=202)
async def resolve_case(case_id: str, background_tasks: BackgroundTasks):
    """Kick off an AI resolution attempt via the Claude Code CLI. Runs in the
    background; poll GET /api/cases/{id} for the result (status leaves
    'resolving' once done)."""
    case = _cases.get(case_id)
    if not case:
        raise HTTPException(404, "Case not found")

    case.status = CaseStatus.RESOLVING
    case.resolution_output = None
    case.resolution_error = None
    cases_db.save_case(case)

    async def _run():
        try:
            output = await run_claude_cli(_build_resolution_prompt(case))
            case.resolution_output = output
            case.status = CaseStatus.RESOLVED
        except ClaudeCliError as exc:
            log.error("cases.resolve.claude_cli_error", error=str(exc), case_id=case_id)
            case.resolution_error = str(exc)
            case.status = CaseStatus.ESCALATED
        finally:
            cases_db.save_case(case)

    background_tasks.add_task(_run)
    return case


@router.get("/{case_id}/stream")
async def stream_case(case_id: str):
    """SSE stream of case intelligence output tokens."""
    case = _cases.get(case_id)
    if not case:
        raise HTTPException(404, "Case not found")

    ingest = CaseIngest(
        title=case.title,
        description=case.description,
        customer=case.customer,
        product=case.product,
        version=case.version,
        priority=case.priority,
    )

    async def _event_stream():
        async for chunk in case_intelligence.stream(ingest):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(_event_stream(), media_type="text/event-stream")
