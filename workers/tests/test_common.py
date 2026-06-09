from extractors.common import ExtractionResult, Attachment, html_to_markdown, detect_source_type


def test_extraction_result_defaults():
    r = ExtractionResult(text="hello", markdown="**hello**", metadata={})
    assert r.text == "hello"
    assert r.markdown == "**hello**"
    assert r.attachments == []


def test_attachment_fields():
    a = Attachment(filename="doc.pdf", data=b"bytes", content_type="application/pdf")
    assert a.filename == "doc.pdf"
    assert a.data == b"bytes"


def test_html_to_markdown_basic():
    md = html_to_markdown("<p>Hello <b>world</b></p>")
    assert "Hello" in md
    assert "world" in md


def test_html_to_markdown_strips_tags():
    md = html_to_markdown("<html><body><p>clean</p></body></html>")
    assert "<html>" not in md
    assert "clean" in md


def test_detect_source_type():
    assert detect_source_type("file.pdf") == "pdf"
    assert detect_source_type("FILE.DOCX") == "docx"
    assert detect_source_type("sheet.xlsx") == "xlsx"
    assert detect_source_type("mail.eml") == "eml"
    assert detect_source_type("outlook.msg") == "msg"
    assert detect_source_type("image.png") == "email_attachment"
