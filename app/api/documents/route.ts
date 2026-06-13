import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const source_type = searchParams.get("source_type");
  const processing_status = searchParams.get("processing_status");
  const case_id = searchParams.get("case_id");
  const date_from = searchParams.get("date_from");
  const date_to = searchParams.get("date_to");
  const q = searchParams.get("q");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);

  let documentIds: string[] | null = null;
  if (case_id) {
    const { data: caseRows } = await supabase
      .from("case_documents")
      .select("document_id")
      .eq("case_id", case_id)
      .eq("user_id", user.id);
    documentIds = (caseRows ?? []).map((r: { document_id: string }) => r.document_id);
    if (documentIds.length === 0) {
      return NextResponse.json({ documents: [], count: 0 });
    }
  }

  let query = supabase
    .from("documents")
    .select(
      "id, original_filename, display_title, source_type, processing_status, chunking_status, document_date, created_at, file_size_bytes, parent_document_id, ai_short_summary",
      { count: "exact" }
    )
    .eq("user_id", user.id);

  if (documentIds !== null) query = query.in("id", documentIds);
  if (source_type) query = query.eq("source_type", source_type);
  if (processing_status) query = query.eq("processing_status", processing_status);
  if (date_from) query = query.gte("document_date", date_from);
  if (date_to) query = query.lte("document_date", date_to);
  if (q) query = query.ilike("original_filename", `%${q}%`);

  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data: documents, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ documents: documents ?? [], count: count ?? 0 });
}
