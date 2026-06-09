import email
import subprocess
import tempfile
from email import policy
from pathlib import Path

import extract_msg
from markitdown import MarkItDown

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".msg", ".eml",
                        ".xlsx", ".csv", ".txt", ".rtf"}
OCR_MIN_CHARS = 100


class ConversionError(Exception):
    pass


def convert_to_markdown(filename: str, content: bytes) -> tuple[str, str]:
    """Return (markdown, converter_used). Raises ConversionError on failure."""
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ConversionError(f"unsupported file type: {ext or '(none)'}")
    try:
        if ext == ".txt":
            return content.decode("utf-8", errors="replace"), "text"
        if ext == ".eml":
            return _convert_eml(content), "eml"
        if ext == ".msg":
            return _convert_msg(content), "msg"
        if ext in (".doc", ".rtf"):
            return _convert_textutil(content, ext), "textutil"
        if ext == ".pdf":
            return _convert_pdf(content)
        return _run_markitdown(content, ext), "markitdown"
    except ConversionError:
        raise
    except Exception as exc:  # markitdown/library errors become ConversionError
        raise ConversionError(str(exc)) from exc


def _run_markitdown(content: bytes, ext: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=ext, delete=True) as f:
        f.write(content)
        f.flush()
        result = MarkItDown().convert(f.name)
    return result.text_content


def _convert_pdf(content: bytes) -> tuple[str, str]:
    md = _run_markitdown(content, ".pdf")
    if len(md.strip()) >= OCR_MIN_CHARS:
        return md, "markitdown"
    return _ocr_pdf(content), "ocr"


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


def _convert_textutil(content: bytes, ext: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=ext, delete=True) as f:
        f.write(content)
        f.flush()
        proc = subprocess.run(
            ["textutil", "-convert", "txt", "-stdout", f.name],
            capture_output=True, timeout=120)
    if proc.returncode != 0:
        raise ConversionError(f"textutil failed: {proc.stderr.decode()[:500]}")
    return proc.stdout.decode("utf-8", errors="replace")


def _convert_eml(content: bytes) -> str:
    msg = email.message_from_bytes(content, policy=policy.default)
    lines = [f"# {msg.get('Subject', '(no subject)')}", "",
             f"- **From:** {msg.get('From', '')}",
             f"- **To:** {msg.get('To', '')}",
             f"- **Date:** {msg.get('Date', '')}", ""]
    body = msg.get_body(preferencelist=("plain", "html"))
    if body is not None:
        lines.append(body.get_content())
    return "\n".join(lines)


def _convert_msg(content: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".msg", delete=True) as f:
        f.write(content)
        f.flush()
        m = extract_msg.Message(f.name)
        try:
            return "\n".join([
                f"# {m.subject or '(no subject)'}", "",
                f"- **From:** {m.sender or ''}",
                f"- **To:** {m.to or ''}",
                f"- **Date:** {m.date or ''}", "",
                m.body or ""])
        finally:
            m.close()
