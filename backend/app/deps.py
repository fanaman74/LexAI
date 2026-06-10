import psycopg
from psycopg.rows import dict_row
from .db import get_conn


def get_db():
    """FastAPI dependency: yield a psycopg connection, commit/rollback on exit."""
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
