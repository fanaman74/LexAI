import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { extractText } from "@/lib/extract/extract";
import { LEGAL_BUCKET, markdownPath } from "@/lib/storage/paths";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();

  // Fetch document
  const { data: doc } = await supabase
    .from("documents")
    .select("id, original_filename, storage_path, storage_bucket, processing_status")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!doc.storage_path) return NextResponse.json({ error: "No file stored yet" }, { status: 422 });

  // Mark as processing
  await supabase.from("documents").update({ processing_status: "processing" }).eq("id", id);

  try {
    // Download file from storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from(doc.storage_bucket ?? LEGAL_BUCKET)
      .download(doc.storage_path);

    if (dlErr || !fileData) throw new Error(dlErr?.message ?? "Download failed");

    const bytes = Buffer.from(await fileData.arrayBuffer());

    // Extract text
    const { text, markdown } = await extractText(bytes, doc.original_filename);

    // Save markdown to storage
    const mdPath = markdownPath(user.id, id, doc.original_filename);
    const mdBytes = Buffer.from(markdown, "utf-8");
    await supabase.storage
      .from(doc.storage_bucket ?? LEGAL_BUCKET)
      .upload(mdPath, mdBytes, { contentType: "text/markdown", upsert: true });

    // Update document record
    await supabase.from("documents").update({
      extracted_text: text.slice(0, 100000),
      markdown_text: markdown.slice(0, 100000),
      markdown_storage_path: mdPath,
      processing_status: "processed",
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    return NextResponse.json({ status: "processed", characters: text.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from("documents").update({
      processing_status: "failed",
      processing_error: msg,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
