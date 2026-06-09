import pathlib
from extractors.eml_extractor import extract

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "sample.eml"


def test_eml_extracts_body():
    result = extract(FIXTURE.read_bytes())
    assert "body text" in result.text.lower()


def test_eml_metadata_headers():
    result = extract(FIXTURE.read_bytes())
    assert result.metadata["from"] == "alice@example.com"
    assert "bob@example.com" in result.metadata["to"]
    assert result.metadata["subject"] == "Evidence email"
    assert result.metadata["message_id"] == "<test-msg-id@example.com>"


def test_eml_markdown_has_header_block():
    result = extract(FIXTURE.read_bytes())
    assert "**From:**" in result.markdown
    assert "**Subject:**" in result.markdown


def test_eml_extracts_attachment():
    result = extract(FIXTURE.read_bytes())
    assert len(result.attachments) == 1
    assert result.attachments[0].filename == "evidence.pdf"
    assert len(result.attachments[0].data) > 0
