from __future__ import annotations

from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class TestFramework(str, Enum):
    PYTEST = "pytest"
    JEST = "jest"
    PLAYWRIGHT = "playwright"
    CYPRESS = "cypress"
    JUNIT = "junit"


class TestFailureKind(str, Enum):
    REAL = "real"
    FLAKY = "flaky"
    ENVIRONMENT = "environment"
    LOCATOR = "locator_broken"


class GeneratedTest(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    bug_case_id: str
    framework: TestFramework
    test_code: str
    test_file_path: str
    description: str
    confidence: float = Field(ge=0.0, le=1.0)
    runnable: bool = False  # set to True after CI validates


class TestFailureTriage(BaseModel):
    test_id: str
    test_name: str
    failure_kind: TestFailureKind
    explanation: str
    healed_locator: Optional[str] = None  # filled for LOCATOR failures
    confidence: float = Field(ge=0.0, le=1.0)
