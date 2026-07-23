from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class TimelineEvent(BaseModel):
    timestamp: datetime
    description: str
    source: str  # "code_change" | "log" | "alert" | "customer_report"
    ado_changeset: Optional[str] = None


class FiveWhy(BaseModel):
    level: int = Field(ge=1, le=5)
    why: str
    answer: str


class SimilarIncident(BaseModel):
    rca_id: str
    title: str
    date: datetime
    similarity_score: float
    key_pattern: str


class RCADraft(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    incident_id: str
    title: str
    summary: str
    timeline: list[TimelineEvent]
    five_whys: list[FiveWhy]
    contributing_factors: list[str]
    preventive_actions: list[str]
    similar_incidents: list[SimilarIncident]
    confidence: float = Field(ge=0.0, le=1.0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
