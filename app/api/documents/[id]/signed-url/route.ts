import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signedUrl } from "@/lib/storage/storage";
import { logAudit } from "@/lib/audit/audit";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind") ?? "original";

  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path, markdown_storage_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (kind === "markdown" && !doc.markdown_storage_path) {
    return NextResponse.json({ error: "No markdown available" }, { status: 400 });
  }

  const path = kind === "markdown" ? doc.markdown_storage_path : doc.storage_path;
  const url = await signedUrl(supabase, path, 300);

  await logAudit(supabase, user.id, "download", {
    document_id: id,
    metadata: { kind },
  });

  return NextResponse.json({ url, expires_in: 300 });
}
