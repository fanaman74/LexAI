import os


class Config:
    supabase_url: str = os.environ["SUPABASE_URL"]
    supabase_service_role_key: str = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    redis_url: str = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    storage_bucket: str = os.environ.get("STORAGE_BUCKET", "legal-documents")
    dispatcher_poll_seconds: float = float(
        os.environ.get("DISPATCHER_POLL_SECONDS", "3")
    )
