# backend/app/chunking.py
import re
from dataclasses import dataclass, field

import tiktoken

_TOKENIZER = tiktoken.get_encoding("cl100k_base")

# Keep legacy constants so existing imports don't break immediately
CHUNK_SIZE = 1500
OVERLAP = 200


@dataclass
class ChunkResult:
    chunk_index: int
    chunk_text: str
    token_count: int
    section_title: str | None = None
    page_number: int | None = None
    metadata: dict = field(default_factory=dict)


def _count(text: str) -> int:
    return len(_TOKENIZER.encode(text))


def _decode_tokens(tokens: list[int]) -> str:
    return _TOKENIZER.decode(tokens)


def _split_into_sections(md: str) -> list[tuple[str | None, str]]:
    """Split markdown on heading lines. Returns [(heading, body)] pairs."""
    sections: list[tuple[str | None, str]] = []
    current_heading: str | None = None
    current_lines: list[str] = []
    for line in md.splitlines(keepends=True):
        m = re.match(r"^#{1,3}\s+(.+)", line)
        if m:
            if current_lines:
                body = "".join(current_lines).strip()
                if body:
                    sections.append((current_heading, body))
            current_heading = m.group(1).strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_lines:
        body = "".join(current_lines).strip()
        if body:
            sections.append((current_heading, body))
    return sections


def chunk_document(
    md: str,
    max_tokens: int = 1000,
    overlap_tokens: int = 150,
    page_number: int | None = None,
) -> list[ChunkResult]:
    """
    Split markdown into token-bounded chunks.
    Respects section headings and paragraph boundaries.
    Carries overlap_tokens of context between consecutive chunks.
    """
    if not md.strip():
        return []

    sections = _split_into_sections(md)
    if not sections:
        # No headings — treat whole text as one nameless section
        sections = [(None, md.strip())]

    results: list[ChunkResult] = []
    overlap_tokens_buf: list[int] = []

    for section_title, body in sections:
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", body) if p.strip()]

        current_tokens: list[int] = list(overlap_tokens_buf)

        for para in paragraphs:
            para_tokens = _TOKENIZER.encode(para)

            # If adding this paragraph would exceed max, flush first
            if current_tokens and len(current_tokens) + len(para_tokens) > max_tokens:
                chunk_text = _decode_tokens(current_tokens)
                results.append(ChunkResult(
                    chunk_index=len(results),
                    chunk_text=chunk_text,
                    token_count=len(current_tokens),
                    section_title=section_title,
                    page_number=page_number,
                ))
                # Carry overlap from end of flushed chunk
                overlap_tokens_buf = current_tokens[-overlap_tokens:] if len(current_tokens) > overlap_tokens else current_tokens[:]
                current_tokens = list(overlap_tokens_buf) + para_tokens
            else:
                if current_tokens:
                    # Add paragraph separator tokens
                    sep = _TOKENIZER.encode("\n\n")
                    current_tokens = current_tokens + sep + para_tokens
                else:
                    current_tokens = para_tokens

            # If a single paragraph is longer than max_tokens, split it
            while len(current_tokens) > max_tokens:
                chunk_tokens = current_tokens[:max_tokens]
                chunk_text = _decode_tokens(chunk_tokens)
                results.append(ChunkResult(
                    chunk_index=len(results),
                    chunk_text=chunk_text,
                    token_count=len(chunk_tokens),
                    section_title=section_title,
                    page_number=page_number,
                ))
                overlap_start = max(0, max_tokens - overlap_tokens)
                current_tokens = current_tokens[overlap_start:]

        # Flush remaining tokens for this section
        if current_tokens:
            chunk_text = _decode_tokens(current_tokens)
            results.append(ChunkResult(
                chunk_index=len(results),
                chunk_text=chunk_text,
                token_count=len(current_tokens),
                section_title=section_title,
                page_number=page_number,
            ))
            overlap_tokens_buf = current_tokens[-overlap_tokens:] if len(current_tokens) > overlap_tokens else current_tokens[:]
        else:
            overlap_tokens_buf = []

    # Ensure chunk_index is sequential (already set above but re-confirm)
    for i, r in enumerate(results):
        r.chunk_index = i

    return results


def chunk_markdown(md: str) -> list[str]:
    """Legacy character-based chunking. Kept for backward compatibility."""
    text = md.strip()
    if not text:
        return []

    max_piece = CHUNK_SIZE - OVERLAP - 2
    pieces: list[str] = []
    for para in text.split("\n\n"):
        para = para.strip()
        if not para:
            continue
        while len(para) > max_piece:
            cut = para.rfind(" ", 0, max_piece)
            if cut < max_piece // 2:
                cut = max_piece
            pieces.append(para[:cut])
            para = para[cut:].strip()
        if para:
            pieces.append(para)

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if current and len(current) + len(piece) + 2 > CHUNK_SIZE:
            chunks.append(current)
            current = current[-OVERLAP:] + "\n\n" + piece
        else:
            current = f"{current}\n\n{piece}" if current else piece
    if current:
        chunks.append(current)
    return chunks
