"""Local embeddings using sentence-transformers (no API needed)."""
from __future__ import annotations

import hashlib

import numpy as np
import structlog

log = structlog.get_logger()
_cache: dict[str, list[float]] = {}
_model = None


def _get_model():
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer("all-MiniLM-L6-v2")
            log.info("embeddings.model_loaded", model="all-MiniLM-L6-v2")
        except ImportError:
            _model = "fallback"
    return _model


def _key(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _fallback_embed(text: str) -> list[float]:
    """Simple deterministic hash-based embedding for when no model is available."""
    vec = np.zeros(384)
    for i, ch in enumerate(text[:384]):
        vec[i % 384] += ord(ch) / 1000.0
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


async def embed(text: str) -> list[float]:
    k = _key(text)
    if k in _cache:
        return _cache[k]

    model = _get_model()
    if model == "fallback" or model is None:
        vector = _fallback_embed(text)
    else:
        vector = model.encode(text).tolist()

    _cache[k] = vector
    return vector


async def embed_batch(texts: list[str]) -> list[list[float]]:
    return [await embed(t) for t in texts]
