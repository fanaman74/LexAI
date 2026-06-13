import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/audit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: doc } = await supabase
    .from("documents")
    .select("id, original_filename, source_type, display_title, markdown_text")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: chunks } = await supabase
    .from("document_chunks")
    .select("chunk_id, chunk_index, content, content_markdown")
    .eq("document_id", id)
    .order("chunk_index", { ascending: true });

  let markdown: string;
  if (chunks && chunks.length > 0) {
    markdown = chunks
      .map((c: { content_markdown?: string | null; content: string }) => c.content_markdown ?? c.content)
      .join("\n\n");
  } else {
    markdown = doc.markdown_text ?? "";
  }

  await logAudit(supabase, user.id, "reconstruct", {
    document_id: id,
    metadata: { filename: doc.original_filename },
  });

  return NextResponse.json({
    document: {
      id: doc.id,
      original_filename: doc.original_filename,
      source_type: doc.source_type,
      display_title: doc.display_title,
    },
    chunks: (chunks ?? []).map((c: { chunk_id: string; chunk_index: number }) => ({
      chunk_id: c.chunk_id,
      chunk_index: c.chunk_index,
    })),
    markdown,
  });
}
