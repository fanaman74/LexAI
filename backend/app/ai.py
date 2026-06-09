import json
import os
import sqlite3

import httpx

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "openai/gpt-oss-120b:free"
MAX_DOC_CHARS = 40_000
SYSTEM_PROMPT = (
    "You are a legal document analysis assistant for a law office. Answer "
    "strictly from the provided documents. Quote the relevant passages and "
    "name the source document for every claim. If the documents do not "
    "contain the answer, say so.")


class AnalysisError(Exception):
    pass


def run_analysis(conn: sqlite3.Connection, file_ids: list[int], prompt: str) -> dict:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise AnalysisError("OPENROUTER_API_KEY is not set (add it to .env)")

    docs = []
    for fid in file_ids:
        row = conn.execute(
            "SELECT f.original_name, m.content_md FROM files f"
            " LEFT JOIN markdown_files m ON m.file_id = f.id WHERE f.id=?",
            (fid,)).fetchone()
        if row is None or row["content_md"] is None:
            raise AnalysisError(f"file {fid} has no converted markdown yet")
        docs.append((row["original_name"], row["content_md"][:MAX_DOC_CHARS]))

    user = prompt + "\n\n" + "\n\n".join(
        f"## Document: {name}\n\n{md}" for name, md in docs)
    response = httpx.post(
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {key}"},
        json={"model": MODEL,
              "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                           {"role": "user", "content": user}]},
        timeout=180)
    response.raise_for_status()
    text = response.json()["choices"][0]["message"]["content"]

    cur = conn.execute(
        "INSERT INTO analyses (file_ids, prompt, response, model) VALUES (?,?,?,?)",
        (json.dumps(file_ids), prompt, text, MODEL))
    conn.commit()
    return {"id": cur.lastrowid, "response": text, "model": MODEL}
