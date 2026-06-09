from celery import Celery
from config import Config

app = Celery(
    "lexai",
    broker=Config.redis_url,
    backend=Config.redis_url,
    include=["jobs.process_document", "jobs.chunk_document"],
)

app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
)
