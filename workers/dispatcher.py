"""
Dispatcher: poll loop that claims queued documents and enqueues Celery tasks.

Run with:
    cd workers && python3 dispatcher.py
"""
from __future__ import annotations
import time
import logging
import signal
from config import Config
from supabase_client import claim_next_document
from jobs.process_document import process_document

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


signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


def run_once() -> bool:
    """Claim one document and dispatch. Return True if a doc was claimed."""
    doc = claim_next_document()
    if not doc:
        return False
    doc_id = doc["id"]
    log.info("Claimed document %s (%s)", doc_id, doc.get("original_filename"))
    process_document.delay(doc_id)
    return True


def main() -> None:
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
