import pytest
from chunking.embeddings import embed_text, embed_batch, EMBEDDING_DIM


def test_embed_text_returns_list():
    vec = embed_text("This is a legal document about contract law.")
    assert isinstance(vec, list)


def test_embed_text_correct_dimensions():
    vec = embed_text("Hello world this is a sentence.")
    assert len(vec) == EMBEDDING_DIM
    assert EMBEDDING_DIM == 768


def test_embed_text_returns_floats():
    vec = embed_text("Evidence was found at the scene of the crime.")
    assert all(isinstance(v, float) for v in vec)


def test_embed_batch_returns_list_of_lists():
    texts = ["First sentence about law.", "Second sentence about evidence."]
    vecs = embed_batch(texts)
    assert isinstance(vecs, list)
    assert len(vecs) == 2
    assert all(len(v) == EMBEDDING_DIM for v in vecs)


def test_embed_batch_empty_returns_empty():
    vecs = embed_batch([])
    assert vecs == []


def test_embed_text_short_raises():
    """Texts shorter than MIN_CHARS should raise ValueError."""
    with pytest.raises(ValueError, match="too short"):
        embed_text("Hi")
