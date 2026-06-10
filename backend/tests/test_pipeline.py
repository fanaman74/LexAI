"""Smoke tests for pipeline — mock the DB to avoid hitting Supabase."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from unittest.mock import MagicMock, patch
import pytest
from app.pipeline import _run_pipeline
from app.convert import ConversionResult


def _make_conn():
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value = {"id": 42}
    conn.execute.return_value.fetchall.return_value = []
    return conn


def test_pipeline_extracting_status():
    conn = _make_conn()
    with patch("app.pipeline.convert_to_markdown") as mock_convert, \
         patch("app.pipeline.ai.summarise_document", return_value=([], None)), \
         patch("app.pipeline.chunk_document", return_value=[]), \
         patch("app.pipeline.embeddings.embed_texts", return_value=[]), \
         patch("app.pipeline.store.save_embeddings"):
        mock_convert.return_value = ConversionResult(
            full_text="Hello world", converter_used="text")
        _run_pipeline(conn, 1, "test.txt", b"Hello world", parent_id=None)

    # Should have set status to extracting, then chunking, embedding, completed
    status_calls = [
        c for c in conn.execute.call_args_list
        if "processing_status" in str(c) and "UPDATE" in str(c)
    ]
    assert len(status_calls) >= 2


def test_pipeline_failed_on_conversion_error():
    conn = _make_conn()
    from app.convert import ConversionError
    with patch("app.pipeline.convert_to_markdown",
               side_effect=ConversionError("bad file")):
        _run_pipeline(conn, 1, "bad.xyz", b"garbage", parent_id=None)

    # Should call set_status with 'failed'
    all_calls_str = str(conn.execute.call_args_list)
    assert "failed" in all_calls_str
