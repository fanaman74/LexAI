# backend/app/convert.py
import email as email_lib
import subprocess
import tempfile
from dataclasses import dataclass, field
from email import policy
from pathlib import Path

import extract_msg
from markitdown import MarkItDown

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".msg", ".eml",
                        ".xlsx", ".csv", ".txt", ".rtf"}
OCR_MIN_CHARS = 100


class ConversionError(Exception):
    pass


@dataclass
class AttachmentData:
    filename: str
    content: bytes
    mime_type: str = ""


@dataclass
class ConversionResult:
    full_text: str
    converter_used: str
    pages: list[str] = field(default_factory=list)
    attachments: list[AttachmentData] = field(default_factory=list)
    email_metadata: dict = field(default_factory=dict)


def convert_to_markdown(filename: str, content: bytes) -> ConversionResult:
    """Extract text from file. Raises ConversionError on failure."""
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ConversionError(f"unsupported file type: {ext or '(none)'}")
    try:
        if ext == ".txt":
            text = content.decode("utf-8", errors="replace")
            return ConversionResult(full_text=text, converter_used="text")
        if ext == ".eml":
            return _convert_eml(content)
        if ext == ".msg":
            return _convert_msg(content)
        if ext in (".doc", ".rtf"):
            text = _convert_textutil(content, ext)
            return ConversionResult(full_text=text, converter_used="textutil")
        if ext == ".pdf":
            return _convert_pdf(content)
        text = _run_markitdown(content, ext)
        return ConversionResult(full_text=text, converter_used="markitdown")
    except ConversionError:
        raise
    except Exception as exc:
        raise ConversionError(str(exc)) from exc


def _run_markitdown(content: bytes, ext: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=ext, delete=True) as f:
        f.write(content)
        f.flush()
        result = MarkItDown().convert(f.name)
    return result.text_content


def _convert_pdf(content: bytes) -> ConversionResult:
    # Try pdfplumber for per-page extraction
    try:
        import io
        import pdfplumber
        pages: list[str] = []
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                pages.append(page.extract_text() or "")
        full = "\n\n---\n\n".join(
            f"<!-- page {i+1} -->\n{p}" for i, p in enumerate(pages) if p.strip()
        )
        if len(full.strip()) >= OCR_MIN_CHARS:
            return ConversionResult(full_text=full, converter_used="pdfplumber", pages=pages)
    except Exception:
        pass
    # Fallback: markitdown
    md = _run_markitdown(content, ".pdf")
    if len(md.strip()) >= OCR_MIN_CHARS:
        return ConversionResult(full_text=md, converter_used="markitdown")
    # OCR fallback
    ocr_text = _ocr_pdf(content)
    return ConversionResult(full_text=ocr_text, converter_used="ocr")


def _ocr_pdf(content: bytes) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.pdf"
        dst = Path(tmp) / "out.pdf"
        src.write_bytes(content)
        try:
            proc = subprocess.run(
                ["ocrmypdf", "--force-ocr", "--quiet", str(src), str(dst)],
                capture_output=True, text=True, timeout=600)
        except FileNotFoundError as exc:
            raise ConversionError(
                "ocrmypdf not installed (brew install ocrmypdf tesseract)") from exc
        if proc.returncode != 0:
            raise ConversionError(f"OCR failed: {proc.stderr.strip()[:500]}")
        return _run_markitdown(dst.read_bytes(), ".pdf")


def _convert_eml(content: bytes) -> ConversionResult:
    msg = email_lib.message_from_bytes(content, policy=policy.default)
    meta = {
        "sender": str(msg.get("from", "")),
        "recipients": str(msg.get("to", "")),
        "subject": str(msg.get("subject", "")),
        "date": str(msg.get("date", "")),
        "message_id": str(msg.get("message-id", "")),
    }
    body_parts: list[str] = []
    attachments: list[AttachmentData] = []
    for part in msg.walk():
        ct = part.get_content_type()
        cd = str(part.get("Content-Disposition", ""))
        if "attachment" in cd:
            fname = part.get_filename() or "attachment"
            payload = part.get_payload(decode=True)
            if payload:
                attachments.append(AttachmentData(
                    filename=fname, content=payload, mime_type=ct))
        elif ct == "text/plain":
            try:
                body_parts.append(part.get_content() or "")
            except Exception:
                pass
        elif ct == "text/html" and not body_parts:
            import re
            try:
                html = part.get_content() or ""
                body_parts.append(re.sub(r"<[^>]+>", " ", html))
            except Exception:
                pass

    header = (
        f"**From:** {meta['sender']}  \n"
        f"**To:** {meta['recipients']}  \n"
        f"**Subject:** {meta['subject']}  \n"
        f"**Date:** {meta['date']}  \n\n"
    )
    full_text = header + "\n\n".join(body_parts)
    return ConversionResult(
        full_text=full_text, converter_used="eml",
        attachments=attachments, email_metadata=meta)


def _convert_msg(content: bytes) -> ConversionResult:
    with tempfile.NamedTemporaryFile(suffix=".msg", delete=False) as f:
        f.write(content)
        tmp_path = f.name
    try:
        m = extract_msg.Message(tmp_path)
        meta = {
            "sender": m.sender or "",
            "recipients": ", ".join(str(r) for r in (m.recipients or [])),
            "subject": m.subject or "",
            "date": str(m.date or ""),
        }
        header = (
            f"**From:** {meta['sender']}  \n"
            f"**To:** {meta['recipients']}  \n"
            f"**Subject:** {meta['subject']}  \n"
            f"**Date:** {meta['date']}  \n\n"
        )
        body = m.body or ""
        attachments: list[AttachmentData] = []
        for att in (m.attachments or []):
            if hasattr(att, "data") and att.data:
                fname = (getattr(att, "longFilename", None)
                         or getattr(att, "shortFilename", None)
                         or "attachment")
                attachments.append(AttachmentData(filename=fname, content=att.data))
        return ConversionResult(
            full_text=header + body, converter_used="msg",
            attachments=attachments, email_metadata=meta)
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _convert_textutil(content: bytes, ext: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=ext, delete=True) as f:
        f.write(content)
        f.flush()
        proc = subprocess.run(
            ["textutil", "-convert", "txt", "-stdout", f.name],
            capture_output=True, timeout=120)
    if proc.returncode != 0:
        raise ConversionError(f"textutil failed: {proc.stderr.decode()[:200]}")
    return proc.stdout.decode("utf-8", errors="replace")
