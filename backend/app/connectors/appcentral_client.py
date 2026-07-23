"""AppCentral (CXT) case connector.

CXT cases are Salesforce Case objects proxied through AppCentral's backend
at {base_url}/aurora/be/api/cxt/cases/{case_id}/?fieldType=extended. That
endpoint was confirmed by inspecting live browser network traffic, but no
service credential exists yet — the API today only works behind a logged-in
user's short-lived (~30 min) session JWT, which is not usable for an
unattended backend integration.

This connector is written against the confirmed request/response shape so
it's ready to use as soon as the AppCentral/CXT platform team issues a
machine-to-machine credential (OAuth2 client-credentials grant or a
long-lived API key — see app.config.settings.appcentral_*). Until then,
every function raises AppCentralNotConfigured.

A search endpoint (POST {base_url}/aurora/be/api/cxt/cases/search/) has been
confirmed, including its request body shape (captured from a live "my open
cases" search): {"queryType": "cases", "filters": {"excludeStatus": [...],
"responsibleParty": [...], "sortBy": ..., "sortOrder": ...}, "limit": ...,
"page": ...}. responsibleParty is a Salesforce Contact Id scoped to whichever
user's session made the request — a service credential may not map to one,
so search_cases() leaves it optional.
"""
from __future__ import annotations

from typing import Any

import httpx
import structlog

from app.config import settings
from app.models.case import CaseIngest, CasePriority

log = structlog.get_logger()

CASE_FIELDS = "extended"

# Salesforce Priority -> Remedium CasePriority
PRIORITY_MAP: dict[str, CasePriority] = {
    "critical": CasePriority.CRITICAL,
    "urgent": CasePriority.CRITICAL,
    "high": CasePriority.HIGH,
    "medium": CasePriority.MEDIUM,
    "normal": CasePriority.MEDIUM,
    "low": CasePriority.LOW,
}


class AppCentralNotConfigured(RuntimeError):
    """Raised when no AppCentral service credential has been configured yet."""


def _configured() -> bool:
    return bool(settings.appcentral_api_key or settings.appcentral_client_id)


def _auth_header() -> dict[str, str]:
    if settings.appcentral_api_key:
        return {"Authorization": f"Bearer {settings.appcentral_api_key}"}
    raise AppCentralNotConfigured(
        "AppCentral service credential not configured. Set APPCENTRAL_API_KEY "
        "(or APPCENTRAL_CLIENT_ID/APPCENTRAL_CLIENT_SECRET once an OAuth2 "
        "client-credentials flow is confirmed) in .env."
    )


def _map_priority(sf_priority: str | None) -> CasePriority:
    if not sf_priority:
        return CasePriority.MEDIUM
    return PRIORITY_MAP.get(sf_priority.strip().lower(), CasePriority.MEDIUM)


async def get_case(case_id: str) -> dict[str, Any]:
    """Fetch a single CXT case by its Salesforce Case Id (e.g. 500a7000010LHlQAAW)."""
    if not _configured():
        raise AppCentralNotConfigured(
            "AppCentral service credential not configured. Set APPCENTRAL_API_KEY "
            "in .env once the AppCentral/CXT platform team issues one."
        )

    async with httpx.AsyncClient(headers=_auth_header(), timeout=15.0) as client:
        resp = await client.get(
            f"{settings.appcentral_base_url}/aurora/be/api/cxt/cases/{case_id}/",
            params={"fieldType": CASE_FIELDS},
        )
        if not resp.is_success:
            log.warning("appcentral.get_case.failed", status=resp.status_code, case_id=case_id)
            resp.raise_for_status()
        return resp.json()["data"]


def to_case_ingest(sf_case: dict[str, Any]) -> CaseIngest:
    """Map a raw Salesforce Case payload to Remedium's CaseIngest shape."""
    account = sf_case.get("Account") or {}
    return CaseIngest(
        title=sf_case.get("Subject") or f"CXT case {sf_case.get('CaseNumber', '')}",
        description=sf_case.get("Description") or "",
        customer=account.get("Name"),
        product=sf_case.get("Product_Name__c") or sf_case.get("Product_Line__c"),
        priority=_map_priority(sf_case.get("Priority")),
        external_id=sf_case.get("CaseNumber") or sf_case.get("Id"),
    )


async def import_case(case_id: str) -> CaseIngest:
    """Fetch a CXT case and map it straight to a CaseIngest, ready for POST /api/cases/."""
    sf_case = await get_case(case_id)
    return to_case_ingest(sf_case)


async def search_cases(
    responsible_party: str | None = None,
    exclude_status: list[str] | None = None,
    top: int = 20,
    page: int = 1,
) -> list[dict[str, Any]]:
    """Search/list CXT cases, e.g. open cases assigned to a given Contact Id."""
    if not _configured():
        raise AppCentralNotConfigured(
            "AppCentral service credential not configured. Set APPCENTRAL_API_KEY "
            "in .env once the AppCentral/CXT platform team issues one."
        )

    filters: dict[str, Any] = {
        "excludeStatus": exclude_status or ["Closed"],
        "sortBy": "lastModifiedDate",
        "sortOrder": "desc",
    }
    if responsible_party:
        filters["responsibleParty"] = [responsible_party]

    async with httpx.AsyncClient(headers=_auth_header(), timeout=15.0) as client:
        resp = await client.post(
            f"{settings.appcentral_base_url}/aurora/be/api/cxt/cases/search/",
            json={"queryType": "cases", "filters": filters, "limit": top, "page": page},
        )
        if not resp.is_success:
            log.warning("appcentral.search_cases.failed", status=resp.status_code)
            resp.raise_for_status()
        return resp.json().get("data", [])


class InvalidCxtSession(RuntimeError):
    """Raised when the caller-supplied CXT session cookie is missing/expired/rejected."""


def _extract_csrf_token(cookie_header: str) -> str | None:
    for part in cookie_header.split(";"):
        part = part.strip()
        if part.startswith("csrftoken="):
            return part.split("=", 1)[1]
    return None


async def search_cases_with_session_cookie(
    cookie: str,
    responsible_party: list[str],
    exclude_status: list[str] | None = None,
    limit: int = 50,
    max_pages: int = 20,
) -> list[dict[str, Any]]:
    """Search CXT cases using a manually-captured browser session cookie.

    This is the auth model CXT actually supports today (Django sessionid/csrftoken
    cookies behind a Keycloak JWT with a ~30 min lifetime) — mirrors
    tools/fetch-cxt-tickets.js exactly, just server-side so the frontend doesn't
    need to shell out. Unlike search_cases() above (written for a service
    credential that doesn't exist yet), this path is confirmed working.
    """
    headers = {
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Origin": settings.appcentral_base_url,
        "Referer": f"{settings.appcentral_base_url}/aurora/cxt?iframe=true",
        "Cookie": cookie,
    }
    csrf_token = _extract_csrf_token(cookie)
    if csrf_token:
        headers["X-CSRFToken"] = csrf_token

    all_cases: list[dict[str, Any]] = []
    async with httpx.AsyncClient(headers=headers, timeout=15.0) as client:
        for page in range(1, max_pages + 1):
            body = {
                "queryType": "cases",
                "filters": {
                    "excludeStatus": exclude_status or ["Closed"],
                    "responsibleParty": responsible_party,
                    "sortBy": "lastModifiedDate",
                    "sortOrder": "desc",
                },
                "sortBy": "lastModifiedDate",
                "sortOrder": "desc",
                "limit": limit,
                "page": page,
            }
            resp = await client.post(
                f"{settings.appcentral_base_url}/aurora/be/api/cxt/cases/search/",
                json=body,
            )
            if resp.status_code in (401, 403):
                raise InvalidCxtSession(
                    "CXT rejected the session cookie (expired or invalid). Capture a fresh "
                    "one from DevTools and try again."
                )
            if not resp.is_success:
                log.warning("appcentral.search_cases_with_session_cookie.failed", status=resp.status_code)
                resp.raise_for_status()

            data = resp.json()
            batch = (data.get("data") or {}).get("cases") if isinstance(data.get("data"), dict) else None
            if batch is None:
                batch = data.get("cases", [])
            all_cases.extend(batch)

            if len(batch) < limit:
                break

    return all_cases


def to_case_ingest_from_search_result(cxt_case: dict[str, Any]) -> CaseIngest:
    """Map a case from the /cxt/cases/search/ response shape (camelCase fields,
    distinct from the Salesforce-shaped /cxt/cases/{id}/ detail response that
    to_case_ingest() above handles)."""
    return CaseIngest(
        title=cxt_case.get("subject") or f"CXT case {cxt_case.get('caseNumber', '')}",
        description=cxt_case.get("description") or cxt_case.get("subject") or "",
        customer=cxt_case.get("account"),
        product=cxt_case.get("product") or cxt_case.get("productLine"),
        priority=_map_priority(cxt_case.get("priority")),
        external_id=cxt_case.get("caseNumber") or cxt_case.get("id"),
    )
