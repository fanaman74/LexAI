import pytest
from app.chunking import chunk_document, ChunkResult

SAMPLE_MD = """# Introduction

This is the introduction paragraph. It has a few sentences about the case.

## Background Facts

The plaintiff entered into a contract on 1 January 2024.
The contract was for the supply of legal services.

## Key Obligations

Payment was due within 30 days of invoice date.
Interest accrues at 8% per annum on late payment.

---

# Conclusion

The matter requires urgent attention before the court date.
"""


def test_chunk_count():
    results = chunk_document(SAMPLE_MD)
    assert len(results) >= 1


def test_chunk_has_required_fields():
    results = chunk_document(SAMPLE_MD)
    r = results[0]
    assert isinstance(r, ChunkResult)
    assert r.chunk_index == 0
    assert r.chunk_text
    assert r.token_count > 0
    assert isinstance(r.section_title, (str, type(None)))


def test_chunk_respects_max_tokens():
    results = chunk_document(SAMPLE_MD, max_tokens=100, overlap_tokens=20)
    for r in results:
        # Allow 30% overflow at word boundaries
        assert r.token_count <= 130


def test_section_title_captured():
    results = chunk_document(SAMPLE_MD)
    titles = [r.section_title for r in results if r.section_title]
    assert len(titles) > 0


def test_chunk_indices_sequential():
    results = chunk_document(SAMPLE_MD)
    for i, r in enumerate(results):
        assert r.chunk_index == i


def test_empty_document():
    results = chunk_document("")
    assert results == []


def test_page_number_passed_through():
    results = chunk_document("Hello world paragraph.", page_number=5)
    assert all(r.page_number == 5 for r in results)
