from __future__ import annotations
import io
from pypdf import PdfReader
from extractors.common import ExtractionResult

_OCR_THRESHOLD = 50  # chars per page below which we flag requires_ocr


def extract(data: bytes) -> ExtractionResult:
    reader = PdfReader(io.BytesIO(data))
    page_count = len(reader.pages)
    pages_text: list[str] = []

    for page in reader.pages:
        text = page.extract_text() or ""
        pages_text.append(text)

    full_text = "\n\n".join(pages_text).strip()
    avg_chars = len(full_text) / page_count if page_count else 0
    requires_ocr = avg_chars < _OCR_THRESHOLD

    page_sections = [f"<!-- page {i+1} -->\n{t}" for i, t in enumerate(pages_text) if t.strip()]
    markdown = "\n\n---\n\n".join(page_sections) if page_sections else ""

    metadata = {
        "page_count": page_count,
        "requires_ocr": requires_ocr,
        "title": reader.metadata.title if reader.metadata else None,
        "author": reader.metadata.author if reader.metadata else None,
    }
    return ExtractionResult(text=full_text, markdown=markdown, metadata=metadata)
