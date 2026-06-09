from __future__ import annotations
from dataclasses import dataclass, field
from markdownify import markdownify


@dataclass
class Attachment:
    filename: str
    data: bytes
    content_type: str = "application/octet-stream"


@dataclass
class ExtractionResult:
    text: str
    markdown: str
    metadata: dict
    attachments: list[Attachment] = field(default_factory=list)


def html_to_markdown(html: str) -> str:
    """Convert HTML to markdown using markdownify."""
    return markdownify(html, heading_style="ATX", strip=["script", "style"]).strip()


_EXT_MAP: dict[str, str] = {
    "pdf": "pdf",
    "docx": "docx",
    "doc": "docx",
    "xlsx": "xlsx",
    "xls": "xlsx",
    "eml": "eml",
    "msg": "msg",
}


def detect_source_type(filename: str) -> str:
    """Return source_type from filename extension; default to email_attachment."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return _EXT_MAP.get(ext, "email_attachment")
