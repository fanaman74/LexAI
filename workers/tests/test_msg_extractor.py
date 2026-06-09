import pathlib
import pytest
from extractors.msg_extractor import extract

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "sample.msg"


def test_msg_returns_extraction_result():
    """Even a stub MSG returns a valid ExtractionResult (never raises)."""
    result = extract(FIXTURE.read_bytes())
    assert result.text is not None
    assert result.markdown is not None
    assert isinstance(result.metadata, dict)
    assert isinstance(result.attachments, list)


def test_msg_failed_parse_sets_error_flag():
    """Corrupt bytes produce a failed ExtractionResult, not an exception."""
    result = extract(b"not a valid msg file at all !!!")
    assert result.metadata.get("parse_error") is True


def test_msg_attachments_is_list():
    result = extract(FIXTURE.read_bytes())
    assert isinstance(result.attachments, list)
