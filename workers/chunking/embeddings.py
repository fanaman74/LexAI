from __future__ import annotations
from functools import lru_cache

EMBEDDING_DIM = 768
MIN_CHARS = 20
MODEL_NAME = "BAAI/bge-base-en-v1.5"
# BGE prefix for query strings only (not document chunks)
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


@lru_cache(maxsize=1)
def _get_model():
    """Lazy-load the SentenceTransformer model (cached for the process lifetime)."""
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(MODEL_NAME)


def embed_text(text: str, is_query: bool = False) -> list[float]:
    """
    Embed a single text string. Raises ValueError if text is too short.
    Pass is_query=True to prepend the BGE query prefix.
    """
    if len(text.strip()) < MIN_CHARS:
        raise ValueError(f"Text too short to embed (min {MIN_CHARS} chars): {text!r}")
    if is_query:
        text = QUERY_PREFIX + text
    model = _get_model()
    vec = model.encode(text, normalize_embeddings=True)
    return vec.tolist()


def embed_batch(texts: list[str], is_query: bool = False) -> list[list[float]]:
    """
    Embed a batch of texts.
    Returns one embedding per input text (all must be long enough — caller filters).
    """
    if not texts:
        return []
    if is_query:
        texts = [QUERY_PREFIX + t for t in texts]
    model = _get_model()
    vecs = model.encode(texts, normalize_embeddings=True, batch_size=32, show_progress_bar=False)
    return [v.tolist() for v in vecs]
