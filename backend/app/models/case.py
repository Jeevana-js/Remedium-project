from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class CaseCategory(str, Enum):
    KNOWN_ISSUE = "known_issue"
    CONFIGURATION = "configuration"
    CONFIRMED_BUG = "confirmed_bug"
    FEATURE_GAP = "feature_gap"
    UNKNOWN = "unknown"


class CasePriority(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class CaseStatus(str, Enum):
    INGESTED = "ingested"
    ANALYSING = "analysing"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    RESOLVING = "resolving"
    RESOLVED = "resolved"
    ESCALATED = "escalated"


class CaseSource(BaseModel):
    id: str
    title: str
    url: Optional[str] = None
    excerpt: str
    relevance_score: float = Field(ge=0.0, le=1.0)
    source_type: str  # "kb_article" | "past_case" | "ado_item" | "rca_doc"


class CasePacket(BaseModel):
    """The full AI-generated resolution packet for a case."""
    diagnosis: str
    category: CaseCategory
    confidence: float = Field(ge=0.0, le=1.0)
    resolution_steps: list[str]
    customer_reply: str
    sources: list[CaseSource]
    ado_item_id: Optional[str] = None
    regression_test_snippet: Optional[str] = None
    rca_draft: Optional[str] = None


class Case(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    external_id: Optional[str] = None  # ID from source case management tool
    title: str
    description: str
    customer: Optional[str] = None
    product: Optional[str] = None
    version: Optional[str] = None
    priority: CasePriority = CasePriority.MEDIUM
    status: CaseStatus = CaseStatus.INGESTED
    category: Optional[CaseCategory] = None
    packet: Optional[CasePacket] = None
    resolution_output: Optional[str] = None
    resolution_error: Optional[str] = None
    # Mirrors CasePacket.regression_test_snippet for cases with no packet at all
    # (resolved via the Claude CLI /resolve path, which produces resolution_output
    # instead of a structured packet) — generate-test writes to whichever exists.
    regression_test_snippet: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CaseIngest(BaseModel):
    title: str
    description: str
    customer: Optional[str] = None
    product: Optional[str] = None
    version: Optional[str] = None
    priority: CasePriority = CasePriority.MEDIUM
    external_id: Optional[str] = None


class ApprovalAction(str, Enum):
    APPROVE = "approve"
    EDIT = "edit"
    REJECT = "reject"
    ESCALATE = "escalate"
    REVOKE = "revoke"


class CaseApproval(BaseModel):
    action: ApprovalAction
    edited_packet: Optional[CasePacket] = None
    note: Optional[str] = None
