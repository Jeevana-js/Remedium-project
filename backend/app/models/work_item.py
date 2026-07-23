from __future__ import annotations

from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class WorkItemType(str, Enum):
    BUG = "Bug"
    TASK = "Task"
    USER_STORY = "User Story"
    EPIC = "Epic"


class WorkItemSeverity(str, Enum):
    CRITICAL = "1 - Critical"
    HIGH = "2 - High"
    MEDIUM = "3 - Medium"
    LOW = "4 - Low"


class CaseCluster(BaseModel):
    """A group of semantically similar cases."""
    cluster_id: UUID = Field(default_factory=uuid4)
    case_ids: list[str]
    centroid_title: str
    common_symptoms: list[str]
    customer_count: int
    suggested_severity: WorkItemSeverity


class WorkItemDraft(BaseModel):
    """ADO work item ready for creation or linking."""
    title: str
    type: WorkItemType = WorkItemType.BUG
    severity: WorkItemSeverity
    area_path: Optional[str] = None
    description: str
    repro_steps: list[str]
    acceptance_criteria: Optional[str] = None
    customer_impact_count: int
    linked_case_ids: list[str]
    existing_ado_id: Optional[str] = None  # set if dedup found an existing item
    confidence: float = Field(ge=0.0, le=1.0)


class WorkItemSynthesisResult(BaseModel):
    clusters: list[CaseCluster]
    drafts: list[WorkItemDraft]
    linked_existing: int
    new_items: int
