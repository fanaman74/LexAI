import pathlib
from extractors.docx_extractor import extract

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "sample.docx"


def test_docx_extracts_text():
    result = extract(FIXTURE.read_bytes())
    assert "LexAI Test Document" in result.text
    assert "paragraph" in result.text.lower()


def test_docx_markdown_has_heading():
    result = extract(FIXTURE.read_bytes())
    assert "# LexAI Test Document" in result.markdown


def test_docx_markdown_has_table():
    result = extract(FIXTURE.read_bytes())
    assert "| Name" in result.markdown or "|Name" in result.markdown


def test_docx_no_attachments():
    result = extract(FIXTURE.read_bytes())
    assert result.attachments == []
