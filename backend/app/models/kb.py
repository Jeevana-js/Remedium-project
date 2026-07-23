from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class ArticleHealth(str, Enum):
    HEALTHY = "healthy"
    STALE = "stale"
    CONTRADICTS = "contradicts"
    GAP = "gap"  # coverage gap — article does not yet exist


class KBArticle(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    external_id: Optional[str] = None
    title: str
    content: str
    product: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    health: ArticleHealth = ArticleHealth.HEALTHY
    freshness_score: float = Field(ge=0.0, le=1.0, default=1.0)
    last_reviewed: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class KBGap(BaseModel):
    gap_id: UUID = Field(default_factory=uuid4)
    description: str
    source_case_ids: list[str]
    draft_article: Optional[KBArticle] = None
    confidence: float = Field(ge=0.0, le=1.0)


class KBHealthReport(BaseModel):
    total_articles: int
    healthy: int
    stale: int
    contradictions: int
    coverage_gaps: int
    gap_details: list[KBGap]
    stale_articles: list[KBArticle]
    contradiction_pairs: list[tuple[str, str]]
