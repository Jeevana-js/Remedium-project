"""Agents API — direct invocation of specialist agents."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.agents import bridge_ops, root_lens, test_forge
from app.models.test_generation import TestFramework
from app.models.work_item import WorkItemSynthesisResult
from app.models.rca import RCADraft
from app.models.test_generation import GeneratedTest, TestFailureTriage

router = APIRouter()


class BridgeOpsRequest(BaseModel):
    cases: list[dict]


class RootLensRequest(BaseModel):
    incident_id: str
    title: str
    description: str
    log_excerpts: list[str] = []


class TestGenRequest(BaseModel):
    bug_title: str
    bug_description: str
    fix_description: str
    framework: TestFramework = TestFramework.PYTEST
    case_id: str = "unknown"


class TestTriageRequest(BaseModel):
    test_id: str
    test_name: str
    failure_log: str
    test_code: str = ""


@router.post("/bridge-ops", response_model=WorkItemSynthesisResult)
async def run_bridge_ops(body: BridgeOpsRequest):
    if not body.cases:
        raise HTTPException(400, "At least one case required")
    return await bridge_ops.run(body.cases)


@router.post("/root-lens", response_model=RCADraft)
async def run_root_lens(body: RootLensRequest):
    return await root_lens.run(
        incident_id=body.incident_id,
        incident_title=body.title,
        incident_description=body.description,
        log_excerpts=body.log_excerpts,
    )


@router.post("/test-forge/generate", response_model=GeneratedTest)
async def run_test_forge(body: TestGenRequest):
    return await test_forge.generate_test(
        bug_title=body.bug_title,
        bug_description=body.bug_description,
        fix_description=body.fix_description,
        framework=body.framework,
        case_id=body.case_id,
    )


@router.post("/test-forge/triage", response_model=TestFailureTriage)
async def triage_test(body: TestTriageRequest):
    return await test_forge.triage_failure(
        test_name=body.test_name,
        test_id=body.test_id,
        failure_log=body.failure_log,
        test_code=body.test_code,
    )
