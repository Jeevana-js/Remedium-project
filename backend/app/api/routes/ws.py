"""WebSocket endpoint — real-time agent progress streaming."""
from __future__ import annotations

import json

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.agents import case_intelligence
from app.models.case import CaseIngest

log = structlog.get_logger()
router = APIRouter()


@router.websocket("/case")
async def ws_case(websocket: WebSocket):
    await websocket.accept()
    try:
        raw = await websocket.receive_text()
        data = json.loads(raw)
        case = CaseIngest(**data)

        await websocket.send_json({"type": "status", "payload": "analysing"})

        # Stream tokens from Case Intelligence
        buffer = ""
        async for chunk in case_intelligence.stream(case):
            buffer += chunk
            await websocket.send_json({"type": "token", "payload": chunk})

        await websocket.send_json({"type": "status", "payload": "done"})
        await websocket.send_json({"type": "raw_output", "payload": buffer})

    except WebSocketDisconnect:
        log.info("ws.case.disconnect")
    except Exception as exc:
        log.error("ws.case.error", error=str(exc))
        await websocket.send_json({"type": "error", "payload": str(exc)})
        await websocket.close()
