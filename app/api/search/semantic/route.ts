import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const EMBED_SERVER_URL = process.env.EMBED_SERVER_URL ?? "http://localhost:8765";

interface SemanticSearchBody {
  query: string;
  case_id?: string;
  limit?: number;
}

interface ChunkResult {
  document_id: string;
  chunk_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

interface DocumentResult {
  document_id: string;
  max_similarity: number;
  chunks: ChunkResult[];
  original_filename?: string;
  source_type?: string;
  processing_status?: string;
}

export async function POST(req: NextRequest) {
  // Auth
  const user = await requireUser();

  // Parse body
  let body: SemanticSearchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { query, case_id, limit = 20 } = body;
  if (!query || typeof query !== "string" || query.trim().length < 3) {
    return NextResponse.json(
      { error: "query must be at least 3 characters" },
      { status: 400 }
    );
  }

  // 1. Embed the query via the Python embed server
  let embedding: number[];
  try {
    const embedRes = await fetch(`${EMBED_SERVER_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: query.trim(), is_query: true }),
    });
    if (!embedRes.ok) {
      const err = await embedRes.text();
      return NextResponse.json(
        { error: `Embed server error: ${err}` },
        { status: 502 }
      );
    }
    const embedData = await embedRes.json();
    embedding = embedData.embedding as number[];
  } catch {
    return NextResponse.json(
      { error: "Embed server unreachable. Is workers/embed_server.py running?" },
      { status: 503 }
    );
  }

  // 2. Call match_document_chunks RPC filtered by user_id
  const supabase = await createClient();
  const { data: chunks, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: embedding,
    match_count: limit * 5, // fetch more, then group & trim
    filter_case_id: case_id ?? null,
    filter_user_id: user.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 3. Group by document_id, keep top 5 chunks per document, rank by max similarity
  const docMap = new Map<string, ChunkResult[]>();
  for (const chunk of (chunks as ChunkResult[]) ?? []) {
    const existing = docMap.get(chunk.document_id) ?? [];
    existing.push(chunk);
    docMap.set(chunk.document_id, existing);
  }

  // Fetch document metadata for result enrichment
  const documentIds = Array.from(docMap.keys());
  const docMeta: Record<string, { original_filename: string; source_type: string; processing_status: string }> = {};
  if (documentIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, original_filename, source_type, processing_status")
      .in("id", documentIds);
    for (const d of docs ?? []) {
      docMeta[d.id] = {
        original_filename: d.original_filename,
        source_type: d.source_type,
        processing_status: d.processing_status,
      };
    }
  }

  const results: DocumentResult[] = Array.from(docMap.entries())
    .map(([document_id, docChunks]) => {
      const topChunks = docChunks
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);
      const max_similarity = topChunks[0]?.similarity ?? 0;
      return {
        document_id,
        max_similarity,
        chunks: topChunks,
        ...docMeta[document_id],
      };
    })
    .sort((a, b) => b.max_similarity - a.max_similarity)
    .slice(0, limit);

  return NextResponse.json({
    query,
    result_count: results.length,
    results,
  });
}
