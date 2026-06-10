import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


def _dsn() -> str:
    """Build PostgreSQL DSN from environment variables.

    Uses the Supabase Session Pooler (port 5432) which supports prepared
    statements and is compatible with psycopg. Falls back to direct host if
    SUPABASE_DB_HOST is set explicitly.
    """
    password = os.environ.get("DB_PASSWORD", "")
    project_ref = "cdztsdygywfbxlfxcipe"
    # Session pooler: postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432
    host = os.environ.get(
        "SUPABASE_DB_HOST",
        "aws-1-eu-central-1.pooler.supabase.com",
    )
    user = f"postgres.{project_ref}"
    return f"postgresql://{user}:{password}@{host}:5432/postgres?sslmode=require"


def get_conn() -> psycopg.Connection:
    """Return a psycopg connection with dict_row factory."""
    return psycopg.connect(_dsn(), row_factory=dict_row)


@contextmanager
def conn_ctx():
    """Context manager that commits on success, rolls back on exception."""
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def run_migration(sql_path: str) -> None:
    """Execute a .sql migration file."""
    with open(sql_path) as f:
        sql = f.read()
    with conn_ctx() as conn:
        conn.execute(sql)
    print(f"Migration {sql_path} complete")
