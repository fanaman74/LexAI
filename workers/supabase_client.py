from __future__ import annotations
import hashlib
from datetime import datetime, timezone
from supabase import create_client, Client
from config import Config

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(Config.supabase_url, Config.supabase_service_role_key)
    return _client


# ── Storage paths (mirrors lib/storage/paths.ts) ──────────────────────────────

def original_path(user_id: str, document_id: str, filename: str) -> str:
    return f"{user_id}/{document_id}/original/{filename}"


def attachment_path(user_id: str, parent_id: str, child_id: str, filename: str) -> str:
    return f"{user_id}/{parent_id}/attachments/{child_id}/{filename}"


def markdown_path(user_id: str, document_id: str, original_filename: str) -> str:
    return f"{user_id}/{document_id}/markdown/{original_filename}.md"


# ── Storage I/O ───────────────────────────────────────────────────────────────

def download_file(storage_path: str) -> bytes:
    client = get_client()
    response = client.storage.from_(Config.storage_bucket).download(storage_path)
    return response


def upload_file(storage_path: str, data: bytes, content_type: str = "application/octet-stream",
                upsert: bool = False) -> None:
    client = get_client()
    client.storage.from_(Config.storage_bucket).upload(
        storage_path, data,
        file_options={"content-type": content_type, "upsert": str(upsert).lower()},
    )


# ── Document DB helpers ───────────────────────────────────────────────────────

def get_document(document_id: str) -> dict:
    client = get_client()
    resp = client.table("documents").select("*").eq("id", document_id).single().execute()
    return resp.data


def update_document(document_id: str, fields: dict) -> None:
    client = get_client()
    client.table("documents").update(fields).eq("id", document_id).execute()


def mark_processed(document_id: str, extracted_text: str, markdown_text: str,
                   markdown_storage_path: str, extra_fields: dict | None = None) -> None:
    fields = {
        "extracted_text": extracted_text,
        "markdown_text": markdown_text,
        "markdown_storage_path": markdown_storage_path,
        "processing_status": "processed",
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if extra_fields:
        extra_fields.pop("search_vector_text", None)
        fields.update(extra_fields)
    update_document(document_id, fields)
    update_search_vector(document_id)


def mark_failed(document_id: str, error: str) -> None:
    update_document(document_id, {
        "processing_status": "failed",
        "processing_error": error,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def find_duplicate(user_id: str, sha256: str) -> str | None:
    """Return existing document_id with same hash for this user, or None."""
    client = get_client()
    resp = (
        client.table("documents")
        .select("id")
        .eq("user_id", user_id)
        .eq("sha256_hash", sha256)
        .limit(1)
        .execute()
    )
    return resp.data[0]["id"] if resp.data else None


def insert_child_document(user_id: str, parent_id: str, filename: str,
                           source_type: str, sha256: str, storage_path: str,
                           file_size: int, duplicate_of: str | None) -> str:
    """Insert an email attachment as a child document. Returns new document_id."""
    client = get_client()
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    resp = client.table("documents").insert({
        "user_id": user_id,
        "original_filename": filename,
        "file_extension": ext,
        "storage_bucket": Config.storage_bucket,
        "storage_path": storage_path,
        "sha256_hash": sha256,
        "duplicate_of_document_id": duplicate_of,
        "source_type": source_type,
        "parent_document_id": parent_id,
        "processing_status": "queued",
    }).execute()
    return resp.data[0]["id"]


def attachment_already_exists(parent_id: str, filename: str, sha256: str) -> bool:
    """Idempotency check: prevent duplicate child docs on reprocess."""
    client = get_client()
    resp = (
        client.table("documents")
        .select("id")
        .eq("parent_document_id", parent_id)
        .eq("original_filename", filename)
        .eq("sha256_hash", sha256)
        .limit(1)
        .execute()
    )
    return bool(resp.data)


def claim_next_document() -> dict | None:
    """Atomically claim one queued document via the DB function."""
    client = get_client()
    resp = client.rpc("claim_next_document", {}).execute()
    if not resp.data:
        return None
    return resp.data[0] if isinstance(resp.data, list) else resp.data


def update_search_vector(document_id: str) -> None:
    """Trigger search_vector recompute via DB RPC."""
    client = get_client()
    client.rpc("update_document_search_vector", {"doc_id": document_id}).execute()
