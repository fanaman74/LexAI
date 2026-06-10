import json
import os
import sqlite3

import httpx

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = os.environ.get("CHAT_MODEL", "openai/gpt-oss-120b:free")
MAX_DOC_CHARS = 40_000
SYSTEM_PROMPT = (
    "You are a legal document analysis assistant for a law office. Answer "
    "strictly from the provided documents. Quote the relevant passages and "
    "name the source document for every claim. If the documents do not "
    "contain the answer, say so.")


class AnalysisError(Exception):
    pass


def build_doc_context(conn: sqlite3.Connection, file_ids: list[int]) -> str:
    """Concatenate converted markdown for the files, capped per document."""
    docs = []
    for fid in file_ids:
        row = conn.execute(
            "SELECT f.original_name, m.content_md FROM files f"
            " LEFT JOIN markdown_files m ON m.file_id = f.id WHERE f.id=?",
            (fid,)).fetchone()
        if row is None or row["content_md"] is None:
            raise AnalysisError(f"file {fid} has no converted markdown yet")
        docs.append(f"## Document: {row['original_name']}\n\n"
                    f"{row['content_md'][:MAX_DOC_CHARS]}")
    return "\n\n".join(docs)


def chat_completion(messages: list[dict]) -> str:
    """Single OpenRouter chat call; returns assistant text."""
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise AnalysisError("OPENROUTER_API_KEY is not set (add it to .env)")
    response = httpx.post(
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {key}"},
        json={"model": MODEL, "messages": messages},
        timeout=180)
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


SUMMARISE_SYSTEM = (
    "You are a legal document analyst. Analyse the document and produce a structured executive summary.\n\n"
    "Respond in this EXACT format and nothing else:\n"
    "KEYWORDS: keyword1, keyword2, ..., keyword15\n"
    "HEADLINE: One sentence stating the document's core purpose and key parties\n"
    "KEY POINTS:\n"
    "- [parties involved and their roles]\n"
    "- [main obligations, rights, or terms]\n"
    "- [key dates, amounts, or deadlines]\n"
    "- [critical clauses, conditions, or risks]\n"
    "- [governing law, jurisdiction, or dispute resolution]\n"
    "BOTTOM LINE: 1-2 sentences on the practical significance or required action\n\n"
    "Rules: exactly 15 keywords; HEADLINE + KEY POINTS + BOTTOM LINE must not exceed 250 words total; "
    "plain English, no unexplained jargon.")

MAX_SUMMARISE_CHARS = 30_000


def summarise_document(content_md: str) -> tuple[list[str], str]:
    """Return (keywords_list, summary_text) for a markdown document.

    Returns ([], "") if the API key is not set rather than raising.
    """
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        return [], ""
    snippet = content_md[:MAX_SUMMARISE_CHARS]
    response = httpx.post(
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": SUMMARISE_SYSTEM},
                {"role": "user", "content": f"Document text:\n\n{snippet}"},
            ],
        },
        timeout=180,
    )
    response.raise_for_status()
    text = response.json()["choices"][0]["message"]["content"].strip()

    keywords: list[str] = []
    parts: list[str] = []
    section = ""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("KEYWORDS:"):
            raw = stripped[len("KEYWORDS:"):].strip()
            keywords = [k.strip() for k in raw.split(",") if k.strip()][:15]
        elif stripped.startswith("HEADLINE:"):
            section = "headline"
            parts.append("HEADLINE: " + stripped[len("HEADLINE:"):].strip())
        elif stripped.startswith("KEY POINTS:"):
            section = "key_points"
        elif stripped.startswith("BOTTOM LINE:"):
            section = "bottom_line"
            parts.append("BOTTOM LINE: " + stripped[len("BOTTOM LINE:"):].strip())
        elif section == "key_points" and (stripped.startswith("-") or stripped.startswith("•")):
            parts.append("• " + stripped.lstrip("-•").strip())
        elif section == "bottom_line" and stripped:
            parts[-1] = parts[-1] + " " + stripped
        elif section == "headline" and stripped:
            parts[0] = parts[0] + " " + stripped
    summary = "\n".join(p for p in parts if p)
    return keywords, summary.strip()


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
