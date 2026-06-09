from __future__ import annotations
import uuid as _uuid
from email.utils import parsedate_to_datetime
from celery_app import app
from supabase_client import (
    get_document, download_file, upload_file,
    mark_processed, mark_failed,
    sha256_hex, find_duplicate, insert_child_document,
    attachment_already_exists, markdown_path, attachment_path,
)
from extractors import extract
from extractors.common import detect_source_type


@app.task(bind=True, max_retries=3, default_retry_delay=30, name="jobs.process_document")
def process_document(self, document_id: str) -> dict:
    """
    Celery task: download original → extract → persist text/markdown/metadata.
    For emails, also creates child attachment documents.
    """
    try:
        row = get_document(document_id)
        user_id = row["user_id"]
        source_type = row["source_type"]
        storage_path = row["storage_path"]
        original_filename = row["original_filename"]

        # Download original file
        raw = download_file(storage_path)

        # Extract
        result = extract(source_type, raw)

        # Upload .md artifact to storage
        md_storage_path = markdown_path(user_id, document_id, original_filename)
        upload_file(
            md_storage_path,
            result.markdown.encode("utf-8"),
            content_type="text/markdown",
            upsert=True,
        )

        # Handle email attachments (EML / MSG)
        if source_type in ("eml", "msg"):
            for att in result.attachments:
                att_sha256 = sha256_hex(att.data)
                if attachment_already_exists(document_id, att.filename, att_sha256):
                    continue  # idempotency
                att_source_type = detect_source_type(att.filename)
                dup_id = find_duplicate(user_id, att_sha256)
                # Generate a deterministic child ID placeholder for path construction
                child_id = str(_uuid.uuid4())
                att_path = attachment_path(user_id, document_id, child_id, att.filename)
                # Upload first (upsert=True prevents orphans on retry), then insert DB row
                upload_file(att_path, att.data, content_type=att.content_type, upsert=True)
                insert_child_document(
                    user_id=user_id,
                    parent_id=document_id,
                    filename=att.filename,
                    source_type=att_source_type,
                    sha256=att_sha256,
                    storage_path=att_path,
                    file_size=len(att.data),
                    duplicate_of=dup_id,
                    child_id=child_id,
                )

        # Build extra fields from metadata / email headers
        extra: dict = {}
        meta = result.metadata
        if source_type in ("eml", "msg"):
            extra["sender"] = meta.get("from", "")
            extra["recipients"] = meta.get("to", [])
            cc = meta.get("cc", [])
            extra["cc"] = cc if isinstance(cc, list) else ([cc] if cc else [])
            extra["email_subject"] = meta.get("subject", "")
            extra["email_message_id"] = meta.get("message_id", "")
            date_str = meta.get("date", "")
            if date_str:
                extra["document_datetime"] = _parse_date(date_str)
        if meta.get("author"):
            extra["author"] = meta["author"]

        mark_processed(
            document_id,
            extracted_text=result.text,
            markdown_text=result.markdown,
            markdown_storage_path=md_storage_path,
            extra_fields=extra,
        )
        return {"status": "processed", "document_id": document_id}

    except Exception as exc:
        if self.request.retries >= self.max_retries:
            mark_failed(document_id, str(exc))
        raise self.retry(exc=exc)


def _parse_date(date_str: str) -> str | None:
    """Try to parse email date string to ISO-8601. Return None on failure."""
    try:
        return parsedate_to_datetime(date_str).isoformat()
    except Exception:
        return None
