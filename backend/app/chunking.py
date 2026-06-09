CHUNK_SIZE = 1500
OVERLAP = 200


def chunk_markdown(md: str) -> list[str]:
    """Split Markdown into ~CHUNK_SIZE-char chunks at paragraph boundaries,
    carrying OVERLAP chars of context between consecutive chunks."""
    text = md.strip()
    if not text:
        return []

    # Pieces must leave room for the overlap carry + separator so assembled
    # chunks never exceed CHUNK_SIZE + OVERLAP.
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
