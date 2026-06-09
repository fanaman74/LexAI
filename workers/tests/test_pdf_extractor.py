import pathlib
from extractors.pdf_extractor import extract

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "sample.pdf"


def test_pdf_returns_extraction_result():
    data = FIXTURE.read_bytes()
    result = extract(data)
    assert result.text is not None
    assert result.markdown is not None
    assert isinstance(result.metadata, dict)


def test_pdf_metadata_has_page_count():
    data = FIXTURE.read_bytes()
    result = extract(data)
    assert "page_count" in result.metadata
    assert result.metadata["page_count"] >= 1


def test_pdf_metadata_has_requires_ocr():
    data = FIXTURE.read_bytes()
    result = extract(data)
    assert "requires_ocr" in result.metadata


def test_pdf_no_attachments():
    data = FIXTURE.read_bytes()
    result = extract(data)
    assert result.attachments == []
