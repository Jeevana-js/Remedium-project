"""Base LLM client — Groq (free, fast, OpenAI-compatible)."""
from __future__ import annotations

from typing import Any, Optional

from groq import AsyncGroq

from app.config import settings

_client: Optional[AsyncGroq] = None


def get_client() -> AsyncGroq:
    global _client
    if _client is None:
        _client = AsyncGroq(api_key=settings.groq_api_key)
    return _client


async def chat(
    messages: list[dict[str, str]],
    tools: Optional[list[dict[str, Any]]] = None,
    temperature: float = 0.2,
) -> Any:
    kwargs: dict[str, Any] = {
        "model": settings.groq_model,
        "messages": messages,
        "temperature": temperature,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"

    return await get_client().chat.completions.create(**kwargs)
