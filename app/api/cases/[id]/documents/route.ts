import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/audit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = await createClient();

  // Verify case ownership
  const { data: caseRow } = await supabase
    .from("cases")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!caseRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: caseDocRows, error: cdError } = await supabase
    .from("case_documents")
    .select("document_id")
    .eq("case_id", id)
    .eq("user_id", user.id);

  if (cdError) return NextResponse.json({ error: cdError.message }, { status: 500 });

  const ids = (caseDocRows ?? []).map((r) => r.document_id as string);
  if (ids.length === 0) return NextResponse.json({ documents: [] });

  const { data: documents, error: docsError } = await supabase
    .from("documents")
    .select("id, original_filename, display_title, source_type, processing_status, chunking_status, document_date, created_at, file_size_bytes, ai_short_summary")
    .in("id", ids)
    .eq("user_id", user.id);

  if (docsError) return NextResponse.json({ error: docsError.message }, { status: 500 });

  return NextResponse.json({ documents });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { document_id } = body as { document_id?: string };

  if (!document_id || document_id.trim() === "") {
    return NextResponse.json({ error: "document_id is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Verify case ownership
  const { data: caseRow } = await supabase
    .from("cases")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!caseRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Verify document ownership
  const { data: doc } = await supabase
    .from("documents")
    .select("id")
    .eq("id", document_id)
    .eq("user_id", user.id)
    .single();

  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const { error } = await supabase
    .from("case_documents")
    .upsert(
      { case_id: id, document_id, user_id: user.id },
      { onConflict: "case_id,document_id", ignoreDuplicates: true }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit(supabase, user.id, "case_assign", { case_id: id, document_id });

  return NextResponse.json({ assigned: true });
}
