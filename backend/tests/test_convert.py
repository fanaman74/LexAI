import pytest

from app import convert


def test_supported_extensions():
    assert convert.SUPPORTED_EXTENSIONS == {
        ".pdf", ".docx", ".doc", ".msg", ".eml", ".xlsx", ".csv", ".txt", ".rtf"}


def test_unsupported_raises():
    with pytest.raises(convert.ConversionError):
        convert.convert_to_markdown("photo.jpg", b"...")


def test_txt():
    md, used = convert.convert_to_markdown("note.txt", "héllo legal".encode())
    assert "héllo legal" in md and used == "text"


def test_csv():
    md, used = convert.convert_to_markdown("t.csv", b"name,amount\nAlpha,100\n")
    assert "Alpha" in md and used == "markitdown"


def test_docx(tmp_path):
    import docx
    p = tmp_path / "brief.docx"
    d = docx.Document()
    d.add_paragraph("The defendant breached the agreement.")
    d.save(p)
    md, used = convert.convert_to_markdown("brief.docx", p.read_bytes())
    assert "defendant breached" in md and used == "markitdown"


def test_xlsx(tmp_path):
    import openpyxl
    p = tmp_path / "fees.xlsx"
    wb = openpyxl.Workbook()
    wb.active.append(["item", "fee"])
    wb.active.append(["filing", 350])
    wb.save(p)
    md, used = convert.convert_to_markdown("fees.xlsx", p.read_bytes())
    assert "filing" in md and used == "markitdown"


def test_eml():
    raw = (b"From: counsel@firm.com\r\nTo: client@example.com\r\n"
           b"Subject: Settlement offer\r\nDate: Mon, 1 Jun 2026 10:00:00 +0000\r\n"
           b"Content-Type: text/plain\r\n\r\nWe propose USD 50,000.\r\n")
    md, used = convert.convert_to_markdown("offer.eml", raw)
    assert "Settlement offer" in md and "50,000" in md and used == "eml"


def test_msg(monkeypatch, tmp_path):
    class FakeMsg:
        sender = "a@b.com"
        to = "c@d.com"
        subject = "Hearing date"
        date = "2026-06-01"
        body = "Hearing moved to July 3."
        def close(self):
            pass
    monkeypatch.setattr(convert.extract_msg, "Message", lambda path: FakeMsg())
    md, used = convert.convert_to_markdown("mail.msg", b"fakebinary")
    assert "Hearing date" in md and "July 3" in md and used == "msg"


def test_rtf_via_textutil():
    raw = rb"{\rtf1\ansi This clause is governed by Swiss law.}"
    md, used = convert.convert_to_markdown("clause.rtf", raw)
    assert "Swiss law" in md and used == "textutil"
