from __future__ import annotations
import io
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from extractors.common import ExtractionResult


def _para_to_markdown(para: Paragraph) -> str:
    style = para.style.name if para.style else ""
    text = para.text.strip()
    if not text:
        return ""
    if style == "Heading 1":
        return f"# {text}"
    if style == "Heading 2":
        return f"## {text}"
    if style.startswith("Heading"):
        level = int(style.split()[-1]) if style.split()[-1].isdigit() else 3
        return "#" * level + f" {text}"
    return text


def _table_to_markdown(table: Table) -> str:
    rows = []
    for i, row in enumerate(table.rows):
        cells = [c.text.strip().replace("|", "\\|") for c in row.cells]
        rows.append("| " + " | ".join(cells) + " |")
        if i == 0:
            rows.append("| " + " | ".join(["---"] * len(cells)) + " |")
    return "\n".join(rows)


def extract(data: bytes) -> ExtractionResult:
    doc = Document(io.BytesIO(data))
    md_parts: list[str] = []
    text_parts: list[str] = []

    for block in doc.element.body:
        tag = block.tag.split("}")[-1] if "}" in block.tag else block.tag
        if tag == "p":
            from docx.text.paragraph import Paragraph as _P
            para = _P(block, doc)
            md = _para_to_markdown(para)
            if md:
                md_parts.append(md)
                text_parts.append(para.text.strip())
        elif tag == "tbl":
            from docx.table import Table as _T
            tbl = _T(block, doc)
            md_parts.append(_table_to_markdown(tbl))
            for row in tbl.rows:
                text_parts.append(" | ".join(c.text.strip() for c in row.cells))

    metadata = {}
    cp = doc.core_properties
    if cp.author:
        metadata["author"] = cp.author
    if cp.created:
        metadata["created"] = str(cp.created)
    if cp.modified:
        metadata["modified"] = str(cp.modified)

    return ExtractionResult(
        text="\n".join(text_parts),
        markdown="\n\n".join(md_parts),
        metadata=metadata,
    )
