"""
TestForge Agent — regression test generation + flaky test triage.

Given a resolved bug + fix context, generates a runnable regression test.
Also triages existing test failures as real / flaky / environment / locator_broken.
"""
from __future__ import annotations

import json

import structlog

from app.agents.base import chat
from app.models.test_generation import (
    GeneratedTest,
    TestFailureKind,
    TestFailureTriage,
    TestFramework,
)

log = structlog.get_logger()

GEN_SCHEMA = {
    "name": "generated_test",
    "description": "A runnable regression test for the fixed bug",
    "parameters": {
        "type": "object",
        "properties": {
            "framework": {"type": "string", "enum": [f.value for f in TestFramework]},
            "test_file_path": {"type": "string"},
            "test_code": {"type": "string"},
            "description": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": ["framework", "test_file_path", "test_code", "description", "confidence"],
    },
}

TRIAGE_SCHEMA = {
    "name": "test_triage",
    "description": "Classify a test failure and optionally heal it",
    "parameters": {
        "type": "object",
        "properties": {
            "failure_kind": {
                "type": "string",
                "enum": [k.value for k in TestFailureKind],
            },
            "explanation": {"type": "string"},
            "healed_locator": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": ["failure_kind", "explanation", "confidence"],
    },
}

GEN_SYSTEM = """You are TestForge, a test-automation expert.
Given a bug description and its fix, write a concise regression test that would have
caught this bug before the fix. Use the framework and conventions specified.
The test must be runnable with no modification other than imports."""

TRIAGE_SYSTEM = """You are TestForge, a test-failure analyst.
Classify the failure as: real (genuine regression), flaky (intermittent),
environment (infra/config issue), or locator_broken (UI locator stale).
If locator_broken, provide the healed locator."""


async def generate_test(
    bug_title: str,
    bug_description: str,
    fix_description: str,
    framework: TestFramework = TestFramework.PYTEST,
    case_id: str = "unknown",
) -> GeneratedTest:
    log.info("test_forge.generate", case_id=case_id, framework=framework.value)

    response = await chat(
        messages=[
            {"role": "system", "content": GEN_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"**Bug:** {bug_title}\n\n"
                    f"**Description:** {bug_description}\n\n"
                    f"**Fix applied:** {fix_description}\n\n"
                    f"**Framework:** {framework.value}"
                ),
            },
        ],
        tools=[{"type": "function", "function": GEN_SCHEMA}],
    )

    msg = response.choices[0].message
    if msg.tool_calls:
        data = json.loads(msg.tool_calls[0].function.arguments)
    else:
        data = json.loads(msg.content or "{}")

    return GeneratedTest(
        bug_case_id=case_id,
        framework=TestFramework(data["framework"]),
        test_file_path=data["test_file_path"],
        test_code=data["test_code"],
        description=data["description"],
        confidence=float(data["confidence"]),
    )


async def triage_failure(
    test_name: str,
    test_id: str,
    failure_log: str,
    test_code: str = "",
) -> TestFailureTriage:
    log.info("test_forge.triage", test_id=test_id)

    response = await chat(
        messages=[
            {"role": "system", "content": TRIAGE_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"**Test:** {test_name}\n\n"
                    f"**Failure log:**\n```\n{failure_log[:2000]}\n```\n\n"
                    f"**Test code:**\n```\n{test_code[:1000]}\n```"
                ),
            },
        ],
        tools=[{"type": "function", "function": TRIAGE_SCHEMA}],
    )

    msg = response.choices[0].message
    if msg.tool_calls:
        data = json.loads(msg.tool_calls[0].function.arguments)
    else:
        data = json.loads(msg.content or "{}")

    return TestFailureTriage(
        test_id=test_id,
        test_name=test_name,
        failure_kind=TestFailureKind(data["failure_kind"]),
        explanation=data["explanation"],
        healed_locator=data.get("healed_locator"),
        confidence=float(data["confidence"]),
    )
