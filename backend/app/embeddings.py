import os

import httpx

EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings"
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "openai/text-embedding-3-small")
BATCH_SIZE = 96


class EmbeddingError(Exception):
    pass


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts via OpenRouter (OpenAI-compatible), batched."""
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise EmbeddingError("OPENROUTER_API_KEY is not set (add it to .env)")
    out: list[list[float]] = []
    for start in range(0, len(texts), BATCH_SIZE):
        batch = texts[start:start + BATCH_SIZE]
        try:
            response = httpx.post(
                EMBEDDINGS_URL,
                headers={"Authorization": f"Bearer {key}"},
                json={"model": EMBEDDING_MODEL, "input": batch},
                timeout=120)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise EmbeddingError(f"embedding request failed: {exc}") from exc
        data = sorted(response.json()["data"], key=lambda d: d["index"])
        out.extend(d["embedding"] for d in data)
    return out
