from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.routes import cases, agents, kb, ado, appcentral, ws, auth
from app.db import kb as kb_db
from app.db import cases as cases_db
from app.models.case import CaseStatus
from app.api.routes.kb import _index_article
from app.api.routes.cases import _index_resolved_case

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("remedium.startup", env=settings.app_env)

    articles = kb_db.load_all()
    for article in articles:
        await _index_article(article)
    log.info("remedium.kb_reindexed", count=len(articles))

    resolved_cases = [c for c in cases_db.load_all().values() if c.status == CaseStatus.APPROVED]
    for case in resolved_cases:
        await _index_resolved_case(case)
    log.info("remedium.cases_reindexed", count=len(resolved_cases))

    yield
    log.info("remedium.shutdown")


app = FastAPI(
    title="Remedium API",
    description="Agentic AI platform for support engineering",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(cases.router, prefix="/api/cases", tags=["cases"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(kb.router, prefix="/api/kb", tags=["knowledge-base"])
app.include_router(ado.router, prefix="/api/ado", tags=["azure-devops"])
app.include_router(appcentral.router, prefix="/api/appcentral", tags=["appcentral"])
app.include_router(ws.router, prefix="/ws", tags=["websocket"])


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.app_env}
