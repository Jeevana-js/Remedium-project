"""AppCentral (CXT) proxy routes.

Fetches a CXT case by ID and ingests it into Remedium as a Case, the same
way POST /api/cases/ does for a manually-entered case. Blocked until a
service credential is configured — see app.connectors.appcentral_client.
"""
from __future__ import annotations

import structlog
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app.connectors.appcentral_client import (
    AppCentralNotConfigured,
    InvalidCxtSession,
    SyncWebhookNotConfigured,
    fetch_tickets_via_sync_webhook,
    import_case,
    search_cases_with_session_cookie,
    to_case_ingest_from_search_result,
)
from app.db import cases as cases_db
from app.models.case import Case, CaseIngest, CaseStatus
from app.orchestrator.graph import OrchestratorState, remedium_graph

router = APIRouter()
log = structlog.get_logger()


@router.get("/cases/{case_id}/preview")
async def preview_case(case_id: str):
    """Fetch and map a CXT case without creating a Remedium Case yet."""
    try:
        return await import_case(case_id)
    except AppCentralNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc


class FetchNewTicketsResult(BaseModel):
    fetched: int
    created: int
    skipped_existing: int
    created_cases: list[Case]


def _ingest_new_cxt_cases(
    cxt_cases: list[dict],
    background_tasks: BackgroundTasks,
) -> FetchNewTicketsResult:
    """Shared dedup + ingest + background-analyse logic for any list of raw
    CXT cases in the /cxt/cases/search/ camelCase shape, regardless of which
    connector fetched them (sync webhook or session-cookie search)."""
    from app.api.routes.cases import _cases, _states  # shared in-memory case store

    existing_external_ids = {c.external_id for c in _cases.values() if c.external_id}

    created_cases: list[Case] = []
    skipped = 0

    for cxt_case in cxt_cases:
        ingest = to_case_ingest_from_search_result(cxt_case)
        if ingest.external_id and ingest.external_id in existing_external_ids:
            skipped += 1
            continue

        case = Case(id=uuid4(), **ingest.model_dump(), status=CaseStatus.INGESTED)
        _cases[str(case.id)] = case
        cases_db.save_case(case)
        created_cases.append(case)
        if ingest.external_id:
            existing_external_ids.add(ingest.external_id)

        async def _run(case: Case = case, ingest: CaseIngest = ingest):
            try:
                state: OrchestratorState = {"case": ingest, "case_id": str(case.id), "approved": False}
                result = await remedium_graph.ainvoke(state)
                _states[str(case.id)] = result
                status_val = result.get("status", "")
                for s in CaseStatus:
                    if s.value == status_val:
                        case.status = s
                        break
                packet = result.get("packet")
                if packet:
                    case.packet = packet
                    case.category = packet.category
            except Exception as exc:
                log.error("appcentral.fetch_new.background_task.error", error=str(exc), case_id=str(case.id))
                case.status = CaseStatus.ESCALATED
            finally:
                cases_db.save_case(case)

        background_tasks.add_task(_run)

    return FetchNewTicketsResult(
        fetched=len(cxt_cases),
        created=len(created_cases),
        skipped_existing=skipped,
        created_cases=created_cases,
    )


class SyncTicketsRequest(BaseModel):
    cookie: str


@router.post("/sync", response_model=FetchNewTicketsResult)
async def sync_tickets(body: SyncTicketsRequest, background_tasks: BackgroundTasks):
    """Pull the current ticket list from the AppCentral sync webhook and
    ingest any not already present, deduped by case number. Simpler than
    /fetch-new (no responsible-party filter needed — the webhook already
    scopes the list), but still needs the same session cookie: the webhook is
    gated behind the same appcentral-int.aptean.com login as every other CXT
    endpoint, confirmed via a direct 401 test from the backend container."""
    try:
        cxt_cases = await fetch_tickets_via_sync_webhook(cookie=body.cookie)
    except SyncWebhookNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    except InvalidCxtSession as exc:
        raise HTTPException(401, str(exc)) from exc
    return _ingest_new_cxt_cases(cxt_cases, background_tasks)


class FetchNewTicketsRequest(BaseModel):
    cookie: str
    responsible_party: list[str]
    exclude_status: list[str] | None = None


@router.post("/fetch-new", response_model=FetchNewTicketsResult)
async def fetch_new_tickets(body: FetchNewTicketsRequest, background_tasks: BackgroundTasks):
    """Pull all matching CXT tickets via a caller-supplied session cookie and
    ingest any not already present (deduped by external_id/case number).
    Superseded by /sync where the sync webhook is configured — kept as a
    fallback for filtering by a specific responsible party."""
    try:
        cxt_cases = await search_cases_with_session_cookie(
            cookie=body.cookie,
            responsible_party=body.responsible_party,
            exclude_status=body.exclude_status,
        )
    except InvalidCxtSession as exc:
        raise HTTPException(401, str(exc)) from exc
    return _ingest_new_cxt_cases(cxt_cases, background_tasks)
