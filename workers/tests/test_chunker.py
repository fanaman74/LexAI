from chunking.chunker import chunk_markdown, Chunk, create_chunk_id

DOCUMENT_ID = "7a2d4c5f-13f9-4e90-b123-9d6b8d3310f4"
USER_ID = "user-1"

SIMPLE_MD = """# Introduction

This is the first paragraph. It has some content here.

This is the second paragraph. More content.

## Section Two

Another paragraph in section two.
"""

LONG_MD = ("This is a sentence that repeats. " * 200)  # ~6400 chars, forces split


def test_chunk_id_format():
    cid = create_chunk_id(DOCUMENT_ID, 3)
    assert cid == f"{DOCUMENT_ID}::chunk::00003"


def test_chunk_id_zero_padded():
    cid = create_chunk_id(DOCUMENT_ID, 0)
    assert cid.endswith("::chunk::00000")


def test_chunks_returns_list_of_chunk():
    chunks = chunk_markdown(SIMPLE_MD, DOCUMENT_ID, USER_ID)
    assert isinstance(chunks, list)
    assert len(chunks) >= 1
    assert all(isinstance(c, Chunk) for c in chunks)


def test_chunks_have_sequential_indices():
    chunks = chunk_markdown(SIMPLE_MD, DOCUMENT_ID, USER_ID)
    for i, c in enumerate(chunks):
        assert c.chunk_index == i


def test_chunk_ids_match_index():
    chunks = chunk_markdown(SIMPLE_MD, DOCUMENT_ID, USER_ID)
    for c in chunks:
        assert c.chunk_id == create_chunk_id(DOCUMENT_ID, c.chunk_index)


def test_long_text_splits_into_multiple_chunks():
    chunks = chunk_markdown(LONG_MD, DOCUMENT_ID, USER_ID)
    assert len(chunks) >= 2


def test_chunks_cover_all_content():
    """All content from the source should appear in at least one chunk."""
    chunks = chunk_markdown(LONG_MD, DOCUMENT_ID, USER_ID)
    combined = " ".join(c.content for c in chunks)
    assert "sentence" in combined
    assert "repeats" in combined


def test_chunk_metadata_fields():
    chunks = chunk_markdown(SIMPLE_MD, DOCUMENT_ID, USER_ID)
    for c in chunks:
        assert c.document_id == DOCUMENT_ID
        assert c.user_id == USER_ID
        assert c.char_count == len(c.content)
        assert c.token_count == c.char_count // 4
        assert isinstance(c.metadata, dict)


def test_section_title_extracted():
    chunks = chunk_markdown(SIMPLE_MD, DOCUMENT_ID, USER_ID)
    titles = [c.metadata.get("section_title") for c in chunks]
    assert any(t in ("Introduction", "Section Two") for t in titles if t)


def test_no_empty_chunks():
    chunks = chunk_markdown(SIMPLE_MD, DOCUMENT_ID, USER_ID)
    for c in chunks:
        assert len(c.content.strip()) >= 1
