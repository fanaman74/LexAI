"""
Embed server: lightweight FastAPI service for query-time embedding.

Run with:
    cd workers && python3 embed_server.py
    # or: uvicorn embed_server:app --port 8765
"""
from __future__ import annotations
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from config import Config
from chunking.embeddings import embed_text, EMBEDDING_DIM, MODEL_NAME

app = FastAPI(title="LexAI Embed Server", version="1.0")


class EmbedRequest(BaseModel):
    text: str
    is_query: bool = True  # applies BGE query prefix by default


class EmbedResponse(BaseModel):
    embedding: list[float]
    dim: int
    model: str


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "dim": EMBEDDING_DIM}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    try:
        vec = embed_text(req.text, is_query=req.is_query)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return EmbedResponse(embedding=vec, dim=EMBEDDING_DIM, model=MODEL_NAME)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=Config.embed_server_port)
