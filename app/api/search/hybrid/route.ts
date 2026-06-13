import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/audit";

const EMBED_SERVER_URL = process.env.EMBED_SERVER_URL ?? "http://localhost:8765";

interface HybridSearchBody {
  query: string;
  case_id?: string;
  limit?: number;
}

interface KeywordRow {
  document_id: string;
  original_filename: string;
  display_title: string;
  source_type: string;
  document_date: string | null;
  ai_short_summary: string | null;
  rank: number;
  snippet: string | null;
}

interface ChunkRow {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

interface DocMeta {
  id: string;
  original_filename: string;
  display_title: string;
  source_type: string;
  document_date: string | null;
  ai_short_summary: string | null;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();

  let body: HybridSearchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { query, case_id } = body;
  if (!query || typeof query !== "string" || query.trim().length < 2) {
    return NextResponse.json(
      { error: "query must be at least 2 characters" },
      { status: 400 }
    );
  }

  const limit = Math.min(body.limit ?? 20, 100);
  const trimmedQuery = query.trim();

  const supabase = await createClient();

  // Run keyword and semantic in parallel with graceful degradation
  const [keywordResult, semanticResult] = await Promise.allSettled([
    // Keyword
    supabase.rpc("keyword_search_documents", {
      search_query: trimmedQuery,
      filter_user_id: user.id,
      filter_case_id: case_id ?? null,
      filter_source_type: null,
      match_count: limit * 2,
    }),
    // Semantic: embed then match
    (async () => {
      const embedRes = await fetch(`${EMBED_SERVER_URL}/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmedQuery, is_query: true }),
      });
      if (!embedRes.ok) {
        throw new Error(`Embed server error: ${await embedRes.text()}`);
      }
      const embedData = await embedRes.json();
      const embedding = embedData.embedding as number[];

      const { data, error } = await supabase.rpc("match_document_chunks", {
        query_embedding: embedding,
        match_count: limit * 3,
        filter_user_id: user.id,
        filter_case_id: case_id ?? null,
      });
      if (error) throw new Error(error.message);
      return data as ChunkRow[];
    })(),
  ]);

  const kwOk = keywordResult.status === "fulfilled" && !keywordResult.value.error;
  const semOk = semanticResult.status === "fulfilled";

  // Determine mode
  let mode: string;
  if (kwOk && semOk) {
    mode = "hybrid";
  } else if (kwOk) {
    mode = "keyword-only";
  } else if (semOk) {
    mode = "semantic-only";
  } else {
    return NextResponse.json({ error: "Search unavailable" }, { status: 500 });
  }

  const kwRows: KeywordRow[] = kwOk ? ((keywordResult as PromiseFulfilledResult<{ data: KeywordRow[] | null; error: unknown }>).value.data ?? []) : [];
  const semChunks: ChunkRow[] = semOk ? ((semanticResult as PromiseFulfilledResult<ChunkRow[]>).value ?? []) : [];

  // Normalize keyword scores
  const maxRank = kwRows.length > 0 ? Math.max(...kwRows.map((r) => r.rank)) : 1;
  const kwScoreMap = new Map<string, { normScore: number; row: KeywordRow }>();
  for (const row of kwRows) {
    kwScoreMap.set(row.document_id, { normScore: maxRank > 0 ? row.rank / maxRank : 0, row });
  }

  // Group semantic chunks by document_id, take max similarity
  const semDocMap = new Map<string, ChunkRow[]>();
  for (const chunk of semChunks) {
    const existing = semDocMap.get(chunk.document_id) ?? [];
    existing.push(chunk);
    semDocMap.set(chunk.document_id, existing);
  }
  const semScoreMap = new Map<string, number>();
  for (const [docId, chunks] of semDocMap.entries()) {
    const maxSim = Math.max(...chunks.map((c) => c.similarity));
    semScoreMap.set(docId, maxSim);
  }

  // Collect all unique doc ids
  const allIds = Array.from(new Set([...kwScoreMap.keys(), ...semScoreMap.keys()]));

  // Fetch doc metadata in one query
  const docMetaMap = new Map<string, DocMeta>();
  if (allIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, original_filename, display_title, source_type, document_date, ai_short_summary")
      .in("id", allIds)
      .eq("user_id", user.id);
    for (const d of (docs ?? []) as DocMeta[]) {
      docMetaMap.set(d.id, d);
    }
  }

  // Merge scores and build results
  type MergedDoc = {
    document_id: string;
    combined_score: number;
    keyword_score: number;
    semantic_score: number;
    matched_chunks: { chunk_id: string; chunk_index: number; similarity: number; content_preview: string }[];
    snippet: string | null;
    original_filename: string;
    display_title: string;
    source_type: string;
    document_date: string | null;
    ai_short_summary: string | null;
  };

  const merged: MergedDoc[] = allIds.map((docId) => {
    const kwScore = kwScoreMap.get(docId)?.normScore ?? 0;
    const semScore = semScoreMap.get(docId) ?? 0;
    const combined_score = 0.5 * kwScore + 0.5 * semScore;
    const meta = docMetaMap.get(docId);
    const kwRow = kwScoreMap.get(docId)?.row ?? null;

    const docChunks = (semDocMap.get(docId) ?? [])
      .sort((a, b) => b.similarity - a.similarity)
      .map((c) => ({
        chunk_id: c.chunk_id,
        chunk_index: c.chunk_index,
        similarity: c.similarity,
        content_preview: c.content.slice(0, 200),
      }));

    return {
      document_id: docId,
      combined_score,
      keyword_score: kwScore,
      semantic_score: semScore,
      matched_chunks: docChunks,
      snippet: kwRow?.snippet ?? null,
      original_filename: meta?.original_filename ?? "",
      display_title: meta?.display_title ?? "",
      source_type: meta?.source_type ?? "",
      document_date: meta?.document_date ?? null,
      ai_short_summary: meta?.ai_short_summary ?? null,
    };
  });

  const results = merged
    .sort((a, b) => b.combined_score - a.combined_score)
    .slice(0, limit)
    .map((d) => ({
      document_id: d.document_id,
      original_filename: d.original_filename,
      display_title: d.display_title,
      source_type: d.source_type,
      document_date: d.document_date,
      ai_short_summary: d.ai_short_summary,
      best_score: d.combined_score,
      keyword_score: d.keyword_score,
      semantic_score: d.semantic_score,
      matched_chunks: d.matched_chunks,
      snippet: d.snippet,
    }));

  await logAudit(supabase, user.id, "search", { metadata: { mode, query } });

  return NextResponse.json({ query, mode, results });
}
