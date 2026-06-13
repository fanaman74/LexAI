import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { signedUrl } from "@/lib/storage/storage";
import { logAudit } from "@/lib/audit/audit";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = await createClient();

  // Fetch case (ownership check)
  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select("id, name, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (caseError || !caseData) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  // Get case document IDs
  const { data: caseDocRows, error: cdError } = await supabase
    .from("case_documents")
    .select("document_id")
    .eq("case_id", id)
    .eq("user_id", user.id);

  if (cdError) {
    return NextResponse.json({ error: "Failed to fetch case documents" }, { status: 500 });
  }

  const docIds = (caseDocRows ?? []).map((r) => r.document_id);
  if (docIds.length === 0) {
    return NextResponse.json({ error: "Case has no documents" }, { status: 422 });
  }

  // Fetch documents
  const { data: docs, error: docsError } = await supabase
    .from("documents")
    .select("id, original_filename, display_title, source_type, processing_status, document_date, file_size_bytes, storage_path, markdown_storage_path, sha256_hash")
    .in("id", docIds)
    .eq("user_id", user.id);

  if (docsError || !docs) {
    return NextResponse.json({ error: "Failed to fetch documents" }, { status: 500 });
  }

  // Generate signed URLs in parallel
  const enrichedDocs = await Promise.all(
    docs.map(async (doc) => {
      const [original_url, markdown_url] = await Promise.all([
        doc.storage_path ? signedUrl(supabase, doc.storage_path, 3600).catch(() => null) : Promise.resolve(null),
        doc.markdown_storage_path ? signedUrl(supabase, doc.markdown_storage_path, 3600).catch(() => null) : Promise.resolve(null),
      ]);
      return { ...doc, original_url, markdown_url };
    })
  );

  const manifest = {
    case_id: id,
    case_name: caseData.name,
    exported_at: new Date().toISOString(),
    expires_in_seconds: 3600,
    document_count: docs.length,
    documents: enrichedDocs.map((d) => ({
      document_id: d.id,
      filename: d.original_filename,
      display_title: d.display_title,
      source_type: d.source_type,
      document_date: d.document_date,
      file_size_bytes: d.file_size_bytes,
      sha256_hash: d.sha256_hash,
      original_url: d.original_url,
      markdown_url: d.markdown_url,
    })),
  };

  await logAudit(supabase, user.id, "case_export", {
    case_id: id,
    metadata: { document_count: docs.length },
  });

  return NextResponse.json(manifest);
}
