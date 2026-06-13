import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: ownership } = await supabase
    .from("documents")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!ownership) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: chunks, error } = await supabase
    .from("document_chunks")
    .select("chunk_id, chunk_index, content, token_count, char_count, section_title, metadata")
    .eq("document_id", id)
    .order("chunk_index", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    document_id: id,
    chunk_count: (chunks ?? []).length,
    chunks: chunks ?? [],
  });
}
