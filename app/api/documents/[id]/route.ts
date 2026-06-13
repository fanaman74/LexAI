import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/audit";
import { LEGAL_BUCKET } from "@/lib/storage/paths";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: document } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!document) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: children } = await supabase
    .from("documents")
    .select("id, original_filename, source_type, processing_status")
    .eq("parent_document_id", id);

  let parent = null;
  if (document.parent_document_id) {
    const { data: parentDoc } = await supabase
      .from("documents")
      .select("id, original_filename")
      .eq("id", document.parent_document_id)
      .single();
    parent = parentDoc ?? null;
  }

  return NextResponse.json({ document, parent, children: children ?? [] });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path, markdown_storage_path, original_filename")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const paths = [doc.storage_path, doc.markdown_storage_path].filter(Boolean) as string[];
  if (paths.length > 0) {
    await supabase.storage.from(LEGAL_BUCKET).remove(paths);
  }

  await supabase.from("documents").delete().eq("id", id).eq("user_id", user.id);

  await logAudit(supabase, user.id, "delete", {
    document_id: id,
    metadata: { filename: doc.original_filename },
  });

  return NextResponse.json({ deleted: true });
}
