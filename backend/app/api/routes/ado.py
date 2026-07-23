"""Azure DevOps proxy routes.

Callers can either rely on the default board configured in .env, or connect
their own org/project/team with a personal access token via POST /connect.
The returned session id is sent back as the X-Ado-Session header on
subsequent requests to target that connection instead of the default.
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.connectors.ado_client import (
    create_work_item,
    get_backlog_items,
    link_case_to_work_item,
    search_work_items,
    test_connection,
)
from app.models.work_item import WorkItemDraft
from app.state.ado_sessions import AdoConnection, create_session, drop_session, get_session

router = APIRouter()

NBEM_AREA_PATH = "Next Business Event Manager"


class WorkItemCreateRequest(BaseModel):
    draft: WorkItemDraft


class LinkRequest(BaseModel):
    work_item_id: str
    case_url: str
    comment: str = ""


class ConnectRequest(BaseModel):
    user_email: str = Field(..., description="Email of the Remedium user this connection belongs to")
    organization: str = Field(..., description="e.g. https://dev.azure.com/YourOrg")
    project: str
    team: str
    pat: str


def _session_conn(x_ado_session: str | None) -> AdoConnection | None:
    """Resolve the connection for this request, or None to use the .env default."""
    if x_ado_session is None:
        return None
    conn = get_session(x_ado_session)
    if conn is None:
        raise HTTPException(401, "Azure DevOps session expired or not found. Please reconnect.")
    return conn


@router.post("/connect")
async def connect(body: ConnectRequest):
    """Validate org/project/team/PAT against the live ADO API, then persist and open a session."""
    conn = AdoConnection(
        organization=body.organization.rstrip("/"),
        project=body.project,
        team=body.team,
        pat=body.pat,
    )
    ok, message = await test_connection(conn)
    if not ok:
        raise HTTPException(400, message)

    session_id = create_session(body.user_email, conn)
    return {
        "session_id": session_id,
        "organization": conn.organization,
        "project": conn.project,
        "team": conn.team,
        "message": message,
    }


@router.get("/connection/{user_email}")
async def get_connection_status(user_email: str):
    """Check whether this user has a saved connection (survives backend restarts)."""
    conn = get_session(user_email.lower())
    if conn is None:
        return {"connected": False}
    return {
        "connected": True,
        "session_id": user_email.lower(),
        "organization": conn.organization,
        "project": conn.project,
        "team": conn.team,
    }


@router.post("/disconnect")
async def disconnect(x_ado_session: str | None = Header(default=None)):
    drop_session(x_ado_session)
    return {"disconnected": True}


@router.get("/work-items/search")
async def search_items(
    q: str, top: int = 10, x_ado_session: str | None = Header(default=None)
):
    conn = _session_conn(x_ado_session)
    return await search_work_items(q, top, conn=conn)


@router.get("/backlog")
async def get_backlog(top: int = 50, x_ado_session: str | None = Header(default=None)):
    """Return the connected team's backlog."""
    conn = _session_conn(x_ado_session)
    return await get_backlog_items(top, conn=conn)


@router.post("/work-items", status_code=201)
async def create_item(
    body: WorkItemCreateRequest, x_ado_session: str | None = Header(default=None)
):
    conn = _session_conn(x_ado_session)
    draft = body.draft
    fields = {
        "System.Title": draft.title,
        "System.AreaPath": draft.area_path or NBEM_AREA_PATH,
        "System.Description": draft.description,
        "Microsoft.VSTS.TCM.ReproSteps": "<ol>"
        + "".join(f"<li>{s}</li>" for s in draft.repro_steps)
        + "</ol>",
        "Microsoft.VSTS.Common.Severity": draft.severity.value,
        "System.Tags": f"remedium; customer-impact-{draft.customer_impact_count}",
    }
    return await create_work_item(draft.type.value, fields, conn=conn)


@router.post("/work-items/{work_item_id}/link")
async def link_case(
    work_item_id: str,
    body: LinkRequest,
    x_ado_session: str | None = Header(default=None),
):
    """Link a Remedium case to an existing ADO work item."""
    conn = _session_conn(x_ado_session)
    success = await link_case_to_work_item(
        work_item_id=work_item_id,
        case_url=body.case_url,
        comment=body.comment,
        conn=conn,
    )
    return {"linked": success, "work_item_id": work_item_id}
