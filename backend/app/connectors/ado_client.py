"""Azure DevOps REST API connector.

All functions take an optional `conn: AdoConnection`. When omitted, they fall
back to the org/project/team/PAT configured in .env (app.config.settings),
so the default NBEM board keeps working. When provided (from a user's
connected session, see app.state.ado_sessions), calls target that board
instead — this is how "connect any org with your own PAT" works.
"""
from __future__ import annotations

import base64
import urllib.parse
from typing import Any

import httpx
import structlog

from app.config import settings
from app.state.ado_sessions import AdoConnection

log = structlog.get_logger()

# NBEM uses "Backlog items" (Product Backlog Item) and "Bug" work item types
WORK_ITEM_FIELDS = [
    "System.Id",
    "System.Title",
    "System.State",
    "System.AreaPath",
    "System.WorkItemType",
    "System.AssignedTo",
    "Microsoft.VSTS.Common.Severity",
    "Microsoft.VSTS.Common.Priority",
    "System.Description",
    "Microsoft.VSTS.TCM.ReproSteps",
    "System.Tags",
    "System.CreatedDate",
]

# Default area path for NBEM backlog items
NBEM_AREA_PATH = "Next Business Event Manager"


def _resolve(conn: AdoConnection | None) -> AdoConnection:
    if conn is not None:
        return conn
    return AdoConnection(
        organization=settings.ado_organization,
        project=settings.ado_project,
        team=settings.ado_team,
        pat=settings.ado_pat,
    )


def _auth_header(conn: AdoConnection | None) -> dict[str, str]:
    token = base64.b64encode(f":{_resolve(conn).pat}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def _base_url(conn: AdoConnection | None) -> str:
    c = _resolve(conn)
    # URL-encode the project name to handle spaces
    project = urllib.parse.quote(c.project, safe="")
    return f"{c.organization}/{project}/_apis"


def _team_url(conn: AdoConnection | None) -> str:
    c = _resolve(conn)
    project = urllib.parse.quote(c.project, safe="")
    team = urllib.parse.quote(c.team, safe="")
    return f"{c.organization}/{project}/{team}/_apis"


async def search_work_items(
    query: str, top: int = 10, conn: AdoConnection | None = None
) -> list[dict[str, Any]]:
    """WIQL search for bugs + backlog items matching the query."""
    c = _resolve(conn)
    # Escape single quotes in query for WIQL
    safe_query = query.replace("'", "''")
    wiql = {
        "query": (
            f"SELECT {', '.join(WORK_ITEM_FIELDS)} FROM WorkItems "
            f"WHERE [System.TeamProject] = '{c.project}' "
            f"AND [System.WorkItemType] IN ('Bug', 'Product Backlog Item', 'Task') "
            f"AND [System.Title] CONTAINS '{safe_query}' "
            f"AND [System.State] <> 'Removed' "
            f"ORDER BY [System.CreatedDate] DESC"
        )
    }
    async with httpx.AsyncClient(headers=_auth_header(conn), timeout=15.0) as client:
        resp = await client.post(
            f"{_base_url(conn)}/wit/wiql?api-version=7.1&$top={top}",
            json=wiql,
        )
        if not resp.is_success:
            log.warning("ado.wiql.failed", status=resp.status_code, body=resp.text[:200])
            return []
        ids = [str(r["id"]) for r in resp.json().get("workItems", [])[:top]]

    if not ids:
        return []

    return await get_work_items(ids, conn=conn)


async def get_work_items(
    ids: list[str], conn: AdoConnection | None = None
) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(headers=_auth_header(conn), timeout=15.0) as client:
        resp = await client.get(
            f"{_base_url(conn)}/wit/workitems",
            params={
                "ids": ",".join(ids),
                "fields": ",".join(WORK_ITEM_FIELDS),
                "api-version": "7.1",
            },
        )
        if not resp.is_success:
            log.warning("ado.get_items.failed", status=resp.status_code)
            return []
        return resp.json().get("value", [])


async def get_backlog_items(
    top: int = 50, conn: AdoConnection | None = None
) -> list[dict[str, Any]]:
    """Fetch the connected team's backlog."""
    async with httpx.AsyncClient(headers=_auth_header(conn), timeout=15.0) as client:
        resp = await client.get(
            f"{_team_url(conn)}/work/backlogs/Microsoft.RequirementCategory/workItems",
            params={"api-version": "7.1"},
        )
        if not resp.is_success:
            log.warning("ado.backlog.failed", status=resp.status_code)
            return []
        items = resp.json().get("workItems", [])[:top]
        ids = [str(i["target"]["id"]) for i in items if "target" in i]

    if not ids:
        return []
    return await get_work_items(ids, conn=conn)


async def create_work_item(
    item_type: str,
    fields: dict[str, Any],
    conn: AdoConnection | None = None,
) -> dict[str, Any]:
    # Ensure it lands in a default area path if none given
    if "System.AreaPath" not in fields:
        fields["System.AreaPath"] = NBEM_AREA_PATH

    patch_doc = [
        {"op": "add", "path": f"/fields/{k}", "value": v}
        for k, v in fields.items()
    ]
    async with httpx.AsyncClient(
        headers={**_auth_header(conn), "Content-Type": "application/json-patch+json"},
        timeout=15.0,
    ) as client:
        resp = await client.post(
            f"{_base_url(conn)}/wit/workitems/${item_type}?api-version=7.1",
            json=patch_doc,
        )
        resp.raise_for_status()
        return resp.json()


async def get_recent_commits(
    days: int = 7, conn: AdoConnection | None = None
) -> list[dict[str, Any]]:
    """Fetch recent commits from all git repos in the connected project."""
    async with httpx.AsyncClient(headers=_auth_header(conn), timeout=15.0) as client:
        resp = await client.get(
            f"{_base_url(conn)}/git/repositories?api-version=7.1",
        )
        if not resp.is_success:
            log.warning("ado.repos.failed", status=resp.status_code)
            return []
        repos = resp.json().get("value", [])

    commits: list[dict] = []
    async with httpx.AsyncClient(headers=_auth_header(conn), timeout=15.0) as client:
        for repo in repos[:5]:
            r = await client.get(
                f"{_base_url(conn)}/git/repositories/{repo['id']}/commits",
                params={"api-version": "7.1", "$top": 20},
            )
            if r.is_success:
                for c in r.json().get("value", []):
                    c["_repo"] = repo.get("name", "")
                commits.extend(r.json().get("value", []))

    return commits


async def link_case_to_work_item(
    work_item_id: str,
    case_url: str,
    comment: str = "",
    conn: AdoConnection | None = None,
) -> bool:
    """Add a hyperlink relation to an existing ADO work item."""
    patch_doc = [
        {
            "op": "add",
            "path": "/relations/-",
            "value": {
                "rel": "Hyperlink",
                "url": case_url,
                "attributes": {"comment": comment or "Linked by Remedium"},
            },
        }
    ]
    async with httpx.AsyncClient(
        headers={**_auth_header(conn), "Content-Type": "application/json-patch+json"},
        timeout=15.0,
    ) as client:
        resp = await client.patch(
            f"{_base_url(conn)}/wit/workitems/{work_item_id}?api-version=7.1",
            json=patch_doc,
        )
        return resp.is_success


async def test_connection(conn: AdoConnection) -> tuple[bool, str]:
    """Validate a connection against the live ADO API. Returns (ok, message)."""
    async with httpx.AsyncClient(
        headers=_auth_header(conn), timeout=15.0, follow_redirects=False
    ) as client:
        try:
            resp = await client.get(
                f"{_team_url(conn)}/work/backlogs/Microsoft.RequirementCategory/workItems",
                params={"api-version": "7.1"},
            )
        except httpx.HTTPError as exc:
            return False, f"Could not reach organization: {exc}"

    if resp.status_code in (301, 302, 401, 203):
        # ADO redirects to a sign-in page (rather than a clean 401) when Basic
        # auth with the PAT fails.
        return False, "Authentication failed — check the personal access token."
    if resp.status_code == 404:
        return False, "Organization, project, or team not found."
    if not resp.is_success:
        return False, f"Azure DevOps returned {resp.status_code}: {resp.text[:200]}"
    return True, "Connected"
