import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/audit";

interface KeywordSearchBody {
  query: string;
  case_id?: string;
  source_type?: string;
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

export async function POST(req: NextRequest) {
  const user = await requireUser();

  let body: KeywordSearchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { query, case_id, source_type } = body;
  if (!query || typeof query !== "string" || query.trim().length < 2) {
    return NextResponse.json(
      { error: "query must be at least 2 characters" },
      { status: 400 }
    );
  }

  const limit = Math.min(body.limit ?? 20, 100);

  const supabase = await createClient();

  const { data: rows, error } = await supabase.rpc("keyword_search_documents", {
    search_query: query.trim(),
    filter_user_id: user.id,
    filter_case_id: case_id ?? null,
    filter_source_type: source_type ?? null,
    match_count: limit,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = ((rows as KeywordRow[]) ?? []).map((row) => ({
    document_id: row.document_id,
    original_filename: row.original_filename,
    display_title: row.display_title,
    source_type: row.source_type,
    document_date: row.document_date,
    ai_short_summary: row.ai_short_summary,
    best_score: row.rank,
    matched_chunks: [],
    snippet: row.snippet,
  }));

  await logAudit(supabase, user.id, "search", { metadata: { mode: "keyword", query } });

  return NextResponse.json({ query, mode: "keyword", results });
}
