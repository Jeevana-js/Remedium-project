"""Knowledge Base API."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.agents import live_kb
from app.db import kb as kb_db
from app.models.kb import KBArticle, KBGap, KBHealthReport
from app.retrieval.vector_store import upsert as vector_upsert

router = APIRouter()


async def _index_article(article: KBArticle) -> None:
    """Keep the in-memory vector store in sync so Resolve's retrieval can find this article."""
    await vector_upsert(
        "kb_articles",
        str(article.id),
        f"{article.title}\n{article.content}",
        {
            "title": article.title,
            "excerpt": article.content[:300],
            "product": article.product,
            "url": None,
        },
    )


class ArticleDraftRequest(BaseModel):
    case_title: str
    case_description: str
    resolution_steps: list[str]
    diagnosis: str
    product: str | None = None


class ArticleIngest(BaseModel):
    external_id: str | None = None
    title: str
    content: str
    product: str | None = None
    tags: list[str] = []


class ArticleContentUpdate(BaseModel):
    content: str


class GapDetectionRequest(BaseModel):
    resolved_cases: list[dict]


@router.get("/articles", response_model=list[KBArticle])
async def list_articles():
    return kb_db.load_all()


@router.post("/articles", response_model=KBArticle, status_code=201)
async def ingest_article(body: ArticleIngest):
    """Store a KB article as-is (e.g. imported from an external source), no LLM drafting."""
    article = KBArticle(
        external_id=body.external_id,
        title=body.title,
        content=body.content,
        product=body.product,
        tags=body.tags,
    )
    kb_db.save_article(article)
    await _index_article(article)
    return article


@router.post("/articles/draft", response_model=KBArticle, status_code=201)
async def draft_article(body: ArticleDraftRequest):
    article = await live_kb.draft_article_for_case(
        case_title=body.case_title,
        case_description=body.case_description,
        resolution_steps=body.resolution_steps,
        diagnosis=body.diagnosis,
        product=body.product,
    )
    kb_db.save_article(article)
    await _index_article(article)
    return article


@router.patch("/articles/{article_id}", response_model=KBArticle)
async def update_article_content(article_id: str, body: ArticleContentUpdate):
    article = kb_db.get_article(article_id)
    if not article:
        raise HTTPException(404, "Article not found")
    article.content = body.content
    kb_db.save_article(article)
    await _index_article(article)
    return article


@router.delete("/articles/{article_id}", status_code=204)
async def delete_article(article_id: str):
    kb_db.delete_article(article_id)


@router.post("/health", response_model=KBHealthReport)
async def kb_health():
    return await live_kb.analyse_health(kb_db.load_all())


@router.post("/gaps", response_model=list[KBGap])
async def detect_gaps(body: GapDetectionRequest):
    return await live_kb.detect_gaps(body.resolved_cases)
