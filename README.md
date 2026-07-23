# Remedium

**From case to cure — one intelligence across every case, bug, test & fix.**

Remedium is an agentic AI platform that unifies the entire support-engineering lifecycle. It ingests a customer case, understands it, retrieves organisational knowledge across every system, decides the resolution path, and acts autonomously — while keeping a human in command.

## Modules

| Module | Agent | Description |
|--------|-------|-------------|
| **Resolve** | Case Intelligence | Classify, diagnose & produce a complete case packet with cited resolution |
| **BridgeOps** | WorkItem Synthesizer | Cluster cases by similarity, dedup against ADO, draft work items |
| **TestForge** | Test Generation | Turn resolved bugs into runnable regression tests; triage flaky tests |
| **RootLens** | RCA Co-pilot | Correlate code, logs & incidents to draft 5-why RCA/REA documents |
| **LiveKB** | Knowledge Base Curator | Detect gaps, stale articles & contradictions; self-draft new articles |

## Architecture

```
frontend/          React + TypeScript + Tailwind (engineer console, approval gate)
backend/           FastAPI + LangGraph (orchestrator, agents, RAG, connectors)
shared/            Pydantic schemas shared between layers
docker-compose.yml Full local stack (backend, frontend, postgres, redis, qdrant)
```

## Quick Start

```bash
# 1. Copy and fill environment variables
cp .env.example .env

# 2. Start all services
docker compose up --build

# 3. Open engineer console
open http://localhost:5173
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Tailwind CSS, Zustand, WebSocket streaming |
| Orchestration | LangGraph, FastAPI, Python 3.11 |
| AI / Reasoning | Azure OpenAI (GPT-4o) + function/tool calling |
| Retrieval | Qdrant (vector), PostgreSQL (pgvector), hybrid search + reranker |
| Integrations | Azure DevOps REST API, MCP connectors |
| Data & Memory | PostgreSQL, Qdrant, Redis (job queue) |
| Platform | Docker Compose (dev), Azure Container Apps (prod) |

## Team

- Jeevana Sakthi S R
- Shalma Ashak Rasool
