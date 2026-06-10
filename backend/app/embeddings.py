import os

import httpx

EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings"
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "openai/text-embedding-3-small")
LOCAL_EMBEDDING_MODEL = os.environ.get(
    "LOCAL_EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
BATCH_SIZE = 96

_local_model = None


class EmbeddingError(Exception):
    pass


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts. Provider chosen by EMBEDDING_PROVIDER:
    'local' (default, fastembed on-device) or 'openrouter'."""
    provider = os.environ.get("EMBEDDING_PROVIDER", "local")
    if provider == "openrouter":
        return _embed_openrouter(texts)
    return _embed_local(texts)


def _embed_local(texts: list[str]) -> list[list[float]]:
    global _local_model
    try:
        if _local_model is None:
            from fastembed import TextEmbedding
            _local_model = TextEmbedding(LOCAL_EMBEDDING_MODEL)
        return [v.tolist() for v in _local_model.embed(texts)]
    except Exception as exc:
        raise EmbeddingError(f"local embedding failed: {exc}") from exc


def _embed_openrouter(texts: list[str]) -> list[list[float]]:
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
