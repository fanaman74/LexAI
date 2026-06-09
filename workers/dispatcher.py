"""
Dispatcher: poll loop that claims queued/processed documents and enqueues Celery tasks.

Run with:
    cd workers && python3 dispatcher.py
"""
from __future__ import annotations
import time
import logging
import signal
from config import Config
from supabase_client import claim_next_document, claim_next_for_chunking
from jobs.process_document import process_document
from jobs.chunk_document import chunk_document

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [dispatcher] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

_running = True


def _handle_signal(sig, frame):
    global _running
    log.info("Signal received, shutting down gracefully…")
    _running = False


def run_once() -> bool:
    """
    Claim one document for processing OR one for chunking.
    Returns True if any work was dispatched.
    """
    dispatched = False

    # 1. Claim for extraction/processing
    doc = claim_next_document()
    if doc:
        doc_id = doc["id"]
        log.info("Claimed for processing: %s (%s)", doc_id, doc.get("original_filename"))
        try:
            process_document.delay(doc_id)
            dispatched = True
        except Exception as e:
            log.error("Failed to enqueue process_document %s: %s", doc_id, e)
            try:
                from supabase_client import update_document
                update_document(doc_id, {"processing_status": "queued"})
            except Exception as reset_err:
                log.error("Failed to reset processing status for %s: %s", doc_id, reset_err)

    # 2. Claim for chunking
    doc2 = claim_next_for_chunking()
    if doc2:
        doc_id2 = doc2["id"]
        log.info("Claimed for chunking: %s (%s)", doc_id2, doc2.get("original_filename"))
        try:
            chunk_document.delay(doc_id2)
            dispatched = True
        except Exception as e:
            log.error("Failed to enqueue chunk_document %s: %s", doc_id2, e)
            try:
                from supabase_client import update_document
                update_document(doc_id2, {"chunking_status": None})
            except Exception as reset_err:
                log.error("Failed to reset chunking status for %s: %s", doc_id2, reset_err)

    return dispatched


def main() -> None:
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    log.info("Dispatcher started (poll_seconds=%.1f)", Config.dispatcher_poll_seconds)
    while _running:
        try:
            claimed = run_once()
            if not claimed:
                time.sleep(Config.dispatcher_poll_seconds)
        except Exception as e:
            log.error("Dispatcher error: %s", e, exc_info=True)
            time.sleep(Config.dispatcher_poll_seconds)
    log.info("Dispatcher stopped.")


if __name__ == "__main__":
    main()
