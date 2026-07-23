# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Remedium is an agentic AI platform for support engineering: it ingests a customer case,
retrieves relevant organizational knowledge, classifies/diagnoses it with an LLM, and
(with a human approval gate) acts — filing an ADO work item, generating a regression
test, and drafting a KB article. Five modules: **Resolve** (case triage, live),
**BridgeOps** (ADO work item synthesis), **TestForge** (regression test generation),
**RootLens** (RCA co-pilot), **LiveKB** (knowledge base curation).

**The README and `.env.example` describe an earlier design (Docker Compose, Postgres,
Qdrant, Redis, Azure OpenAI) that was replaced during development. Treat this CLAUDE.md
and the code under `backend/app/` as the source of truth, not the README.**

## Actual stack (no Docker required for local dev)

- **LLM**: Groq (`llama-3.3-70b-versatile`), OpenAI-compatible, via `app/agents/base.py`.
  Configured with `GROQ_API_KEY` / `GROQ_MODEL` in `.env` (repo root, not `backend/`).
- **Vector store**: pure in-memory cosine similarity (`app/retrieval/vector_store.py`) —
  no Qdrant. Collections: `kb_articles`, `past_cases`, `rca_docs`, `ado_items`.
- **Embeddings**: `sentence-transformers` (`all-MiniLM-L6-v2`) with a deterministic
  hash-based fallback if the package isn't installed (`app/retrieval/embeddings.py`).
- **Persistence**: JSON files under `backend/app/db/` (`users.json`, `cases.json`,
  `ado_connections.json`), written atomically (temp file + `os.replace`). No Postgres/Redis.
  Orchestrator run state (`_states` in `cases.py`) is in-memory only and does not survive
  a backend restart — only the `Case` record (including its `packet` once analysis
  finishes) is persisted.
- **Frontend**: React 18 + TypeScript + Vite + Tailwind + Zustand + TanStack Query, talking
  to the backend through Vite's dev proxy (`/api`, `/ws` → `http://localhost:8000`).
- A `Dockerfile` exists in both `backend/` and `frontend/` plus a root `docker-compose.yml`
  for optional containerized deployment, but everyday development runs both processes
  directly (see Commands below) — don't assume Docker is running.

## Commands

Backend (run from `backend/`, after activating `.venv`):
```
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
```
`--reload-dir app` is required — plain `--reload` watches the whole `backend/` folder
including `.venv`, so any `pip install` triggers a restart loop. `uvicorn` must be run
from inside `backend/` (it imports `app.main:app`); running from the repo root fails with
`ModuleNotFoundError: No module named 'app'`.

Or double-click `start-backend.bat` / `start-frontend.bat` at the repo root, which `cd`
into the right folder first.

Frontend (run from `frontend/`):
```
npm run dev       # Vite dev server, default :5173 (auto-bumps to :5174 if taken)
npm run build     # tsc && vite build
npm run lint      # eslint src --ext .ts,.tsx
npx tsc --noEmit  # type-check only
```

No test suite exists yet in either backend or frontend.

Health check: `GET http://localhost:8000/health`.

## Environment

`.env` lives at the **repo root** (not inside `backend/`) — `app/config.py` loads it via
`env_file="../.env"` relative to `backend/`. Required keys actually read by `Settings`:
`GROQ_API_KEY`, `GROQ_MODEL`, `ADO_ORGANIZATION`, `ADO_PROJECT`, `ADO_TEAM`, `ADO_PAT`,
`APP_ENV`, `SECRET_KEY`, `CORS_ORIGINS`. `.env.example` is stale (Azure OpenAI/Postgres/
Qdrant/Redis) — don't use it as a template; check `app/config.py` for the real schema.

## Architecture

### Orchestration (`backend/app/orchestrator/graph.py`)

A LangGraph `StateGraph` over a `TypedDict` (`OrchestratorState`, not a Pydantic model —
LangGraph 1.x nodes are plain dict-returning async functions and read/write state with
`state["key"]` / `state.get("key")`, never attribute access). Node flow:

```
intake → analyse → (route: escalate | pending_approval)
pending_approval → (route: act | END)   -- gated on state["approved"]
act → learn → END
escalate → END
```

- `analyse` calls `case_intelligence.run()` (the Resolve agent) and routes to `escalate`
  if it throws or returns `confidence < CONFIDENCE_THRESHOLD` (0.6).
- `act` only fires once a human sets `approved=True` via `POST /api/cases/{id}/approve`.
  For cases classified `confirmed_bug`, it invokes `bridge_ops.run()` (ADO work item) and
  `test_forge.generate_test()`, independently try/except-wrapped so one failing doesn't
  block the other or fail the whole request.
- `learn` drafts a KB article from the resolution via `live_kb.draft_article_for_case()`.

`app/api/routes/cases.py` invokes `remedium_graph.ainvoke()` inside a `BackgroundTasks`
callback (fire-and-forget from the client's POV) and persists the resulting `Case` to
`app/db/cases.py` regardless of success or failure (`finally: cases_db.save_case(case)`).
Poll `GET /api/cases/{id}` for the result once background processing finishes.

### Agents (`backend/app/agents/*.py`)

All follow the same shape: build a prompt with retrieved context, call
`app.agents.base.chat()` with a JSON-schema tool definition (`tool_choice="auto"`), parse
`message.tool_calls[0].function.arguments` as the structured result. `case_intelligence.py`
additionally exposes a `stream()` variant for token-by-token SSE (`GET
/api/cases/{id}/stream`), used independently of the orchestrator/background-task path.

### Retrieval (`backend/app/retrieval/`)

`retriever.retrieve_for_case()` fans out `asyncio.gather` across all four in-memory
collections, converts hits to `CaseSource`, sorts by `relevance_score` descending, returns
top `2 * top_k`. There's no separate ingestion pipeline visible yet — `vector_store.upsert()`
is the write path collections would be populated through.

### Azure DevOps integration — per-user sessions over a default board

Two layers:
- `app/connectors/ado_client.py` — stateless REST calls (WIQL search, backlog fetch,
  work item CRUD, hyperlink-based case linking). Every function takes an optional
  `conn: AdoConnection`; when omitted it falls back to the `.env`-configured org/project/
  team/PAT (the default NBEM board).
- `app/state/ado_sessions.py` + `app/db/ado_connections.py` — a user can `POST
  /api/ado/connect` with their own org/project/team/PAT; it's validated live
  (`test_connection`), cached in memory, and persisted to disk (PAT encrypted via Fernet,
  key derived in `ado_connections.py`). The session id is the user's lowercased email,
  sent back as the `X-Ado-Session` header on later requests to target that board instead
  of the default. Sessions transparently reload from disk after a backend restart.

When adding a new connector (e.g. AppCentral), mirror this exact two-layer pattern rather
than inventing a new one — `AppCentralTicketForm.tsx` on the frontend already documents
this as the intended next step (currently a paste-and-parse form; no live API yet, since
AppCentral credentials/API docs aren't available).

### Auth

Not JWT/session-cookie based. `app/api/routes/auth.py` exposes `POST /api/auth/register`
and `POST /api/auth/login`, both checking against `app/db/users.py` (SHA-256 password
hash — not bcrypt, note this is not production-grade if that ever matters). The frontend
(`useAuthStore.ts`, zustand + `persist`) just stores `{name, email}` in localStorage after
a successful call; there is no token sent on subsequent API requests, so backend routes
other than `/api/auth/*` are not actually access-controlled by login state.

### Frontend structure

- `src/App.tsx` gates all routes behind `useAuthStore().isLoggedIn`, rendering
  `LoginPage` otherwise.
- `src/store/` — zustand stores (`useAuthStore`, `useCaseStore`), both with `persist`.
- `src/pages/` — one page per module/route; `CasesPage.tsx` is Resolve's list+intake view,
  toggling between `CaseIngestForm` (manual) and `AppCentralTicketForm` (paste-parse).
- Vite proxies `/api` and `/ws` to `localhost:8000` (`vite.config.ts`) — frontend code
  calls relative paths (`axios.get("/api/cases/")`), never an absolute backend URL.

## Gotchas specific to this repo

- **`backend/requirements.txt` is missing packages the code actually imports**: `groq`
  (used by `app/agents/base.py`), `email-validator` (Pydantic `EmailStr` in
  `app/models/user.py`), `cryptography` (Fernet in `app/db/ado_connections.py`), and
  `sentence-transformers` (optional — falls back to a hash embedding if absent, but install
  it for real retrieval quality). A fresh `pip install -r requirements.txt` will look like
  it succeeded and then fail on import (`ModuleNotFoundError`) the first time that code path
  runs. Install these manually until `requirements.txt` is updated to match.
- `OrchestratorState` is a `TypedDict`: use `state["x"]` / `state.get("x")` /
  `state["x"] = y`, never `state.x` — that was a real bug fixed during development
  (background task silently failed with no case packet ever appearing).
- `case_intelligence.stream()` must not import anything not defined in `app/agents/base.py`
  (there is no `get_llm` — only `get_client()` and `chat()`).
- Backend must run with `--reload-dir app` (see Commands) or file-watching the `.venv`
  causes a restart loop that can crash mid-reload with `KeyboardInterrupt` /
  `RuntimeWarning: coroutine 'Server.serve' was never awaited`.
- `tsconfig.json` intentionally has no `baseUrl`/`paths` — nothing in `src/` uses a `@/`
  alias; don't re-add it.
