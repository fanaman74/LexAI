from __future__ import annotations
import re
from dataclasses import dataclass, field


TARGET_CHARS = 4000   # ≈ 1000 tokens at 4 chars/token
OVERLAP_CHARS = 400   # ≈ 100 tokens carried into next chunk
MIN_CHUNK_CHARS = 20  # skip trivially short content


@dataclass
class Chunk:
    document_id: str
    user_id: str
    chunk_id: str
    chunk_index: int
    content: str
    content_markdown: str
    token_count: int
    char_count: int
    metadata: dict = field(default_factory=dict)
    embedding: list[float] | None = None


def create_chunk_id(document_id: str, chunk_index: int) -> str:
    return f"{document_id}::chunk::{chunk_index:05d}"


def chunk_markdown(
    markdown_text: str,
    document_id: str,
    user_id: str,
    metadata: dict | None = None,
) -> list[Chunk]:
    """
    Split markdown into overlapping chunks respecting heading and paragraph boundaries.
    Returns list of Chunk dataclasses ordered by chunk_index.
    """
    if not markdown_text or not markdown_text.strip():
        return []

    base_meta = metadata or {}
    raw_blocks = _split_into_blocks(markdown_text)
    raw_chunks = _assemble_chunks(raw_blocks)
    result: list[Chunk] = []
    for content, section_title, page_num in raw_chunks:
        content = content.strip()
        if len(content) < MIN_CHUNK_CHARS:
            continue
        idx = len(result)
        meta = {**base_meta}
        if section_title:
            meta["section_title"] = section_title
        if page_num is not None:
            meta["page_start"] = page_num
        result.append(Chunk(
            document_id=document_id,
            user_id=user_id,
            chunk_id=create_chunk_id(document_id, idx),
            chunk_index=idx,
            content=content,
            content_markdown=content,
            char_count=len(content),
            token_count=len(content) // 4,
            metadata=meta,
        ))
    return result


def _split_into_blocks(text: str) -> list[tuple[str, str | None, int | None]]:
    """
    Yield (block_text, section_title, page_num) tuples.
    Headings and page markers update the current section/page context.
    """
    heading_re = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)
    page_re = re.compile(r'<!--\s*page\s+(\d+)\s*-->')

    blocks: list[tuple[str, str | None, int | None]] = []
    current_section: str | None = None
    current_page: int | None = None

    raw_blocks = re.split(r'\n{2,}', text)
    for block in raw_blocks:
        block = block.strip()
        if not block:
            continue

        pm = page_re.search(block)
        if pm:
            current_page = int(pm.group(1))
            clean = page_re.sub('', block).strip()
            if clean:
                blocks.append((clean, current_section, current_page))
            continue

        hm = heading_re.match(block)
        if hm:
            current_section = hm.group(2).strip()
            blocks.append((block, current_section, current_page))
            continue

        blocks.append((block, current_section, current_page))

    return blocks


def _split_large_block(text: str) -> list[str]:
    """Split a single oversized block into sentence-boundary sub-blocks."""
    sentence_re = re.compile(r'(?<=[.!?])\s+')
    sentences = sentence_re.split(text)
    parts: list[str] = []
    current: list[str] = []
    current_len = 0
    for s in sentences:
        if current_len + len(s) > TARGET_CHARS and current:
            parts.append(" ".join(current))
            current = [s]
            current_len = len(s)
        else:
            current.append(s)
            current_len += len(s)
    if current:
        parts.append(" ".join(current))
    return parts if parts else [text]


def _assemble_chunks(
    blocks: list[tuple[str, str | None, int | None]],
) -> list[tuple[str, str | None, int | None]]:
    """
    Accumulate blocks into TARGET_CHARS-sized chunks with OVERLAP_CHARS carry-over.
    """
    chunks: list[tuple[str, str | None, int | None]] = []
    buffer: list[str] = []
    buffer_chars = 0
    buf_section: str | None = None
    buf_page: int | None = None
    overlap_text = ""

    def flush() -> None:
        nonlocal buffer, buffer_chars, overlap_text, buf_section, buf_page
        if not buffer:
            return
        content = "\n\n".join(buffer)
        if overlap_text:
            content = overlap_text + "\n\n" + content
        chunks.append((content.strip(), buf_section, buf_page))
        overlap_text = content[-OVERLAP_CHARS:] if len(content) > OVERLAP_CHARS else content
        buffer = []
        buffer_chars = 0

    for text, section, page in blocks:
        if section and section != buf_section and buffer:
            if buffer_chars >= TARGET_CHARS // 2:
                flush()
                buf_section = section
                buf_page = page
        if page is not None and buf_page is None:
            buf_page = page
        if section and buf_section is None:
            buf_section = section

        # If a single block exceeds TARGET_CHARS, split it by sentences
        if len(text) > TARGET_CHARS:
            for sub_text in _split_large_block(text):
                buffer.append(sub_text)
                buffer_chars += len(sub_text)
                if buffer_chars >= TARGET_CHARS:
                    flush()
        else:
            buffer.append(text)
            buffer_chars += len(text)

        if buffer_chars >= TARGET_CHARS:
            flush()

    flush()
    return chunks
