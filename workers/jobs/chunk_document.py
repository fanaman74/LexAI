from __future__ import annotations
from celery_app import app
from supabase_client import (
    get_document,
    delete_document_chunks,
    upsert_chunks,
    mark_document_chunked,
    mark_document_chunk_failed,
)
from chunking.chunker import chunk_markdown
from chunking.embeddings import embed_batch, MIN_CHARS


@app.task(bind=True, max_retries=3, default_retry_delay=60, name="jobs.chunk_document")
def chunk_document(self, document_id: str) -> dict:
    """
    Celery task: chunk the stored markdown, embed each chunk, upsert into document_chunks.
    Idempotent: deletes existing chunks before reinserting.
    """
    try:
        row = get_document(document_id)
        user_id = row["user_id"]
        markdown_text = row.get("markdown_text") or ""

        if not markdown_text.strip():
            # No text to chunk (OCR-required PDFs, empty docs, etc.)
            mark_document_chunked(document_id)
            return {"status": "chunked", "document_id": document_id, "chunk_count": 0}

        # 1. Chunk the markdown
        chunks = chunk_markdown(
            markdown_text,
            document_id=document_id,
            user_id=user_id,
            metadata={
                "source_type": row.get("source_type"),
                "original_filename": row.get("original_filename"),
            },
        )

        if not chunks:
            mark_document_chunked(document_id)
            return {"status": "chunked", "document_id": document_id, "chunk_count": 0}

        # 2. Embed chunks that are long enough
        embeddable_indices = [i for i, c in enumerate(chunks) if c.char_count >= MIN_CHARS]
        embeddable_texts = [chunks[i].content for i in embeddable_indices]
        embeddings = embed_batch(embeddable_texts)

        for list_pos, chunk_idx in enumerate(embeddable_indices):
            chunks[chunk_idx].embedding = embeddings[list_pos]

        # 3. Idempotent: delete existing chunks
        delete_document_chunks(document_id)

        # 4. Upsert all chunks
        rows = [
            {
                "user_id": user_id,
                "document_id": document_id,
                "chunk_id": c.chunk_id,
                "chunk_index": c.chunk_index,
                "content": c.content,
                "content_markdown": c.content_markdown,
                "token_count": c.token_count,
                "char_count": c.char_count,
                "embedding": c.embedding,
                "metadata": c.metadata,
                "section_title": c.metadata.get("section_title"),
            }
            for c in chunks
        ]
        upsert_chunks(rows)

        # 5. Mark document as chunked
        mark_document_chunked(document_id)

        return {
            "status": "chunked",
            "document_id": document_id,
            "chunk_count": len(chunks),
        }

    except Exception as exc:
        if self.request.retries >= self.max_retries:
            mark_document_chunk_failed(document_id, str(exc))
        raise self.retry(exc=exc)
