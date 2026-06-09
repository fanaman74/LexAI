from fastapi import Request

from .db import get_conn


def get_db(request: Request):
    conn = get_conn(request.app.state.db_path)
    try:
        yield conn
    finally:
        conn.close()
