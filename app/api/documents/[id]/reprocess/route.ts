import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/audit";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase.rpc("reset_document_for_reprocess", {
    doc_id: id,
    requesting_user: user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit(supabase, user.id, "reprocess", { document_id: id });

  return NextResponse.json({ status: "queued" });
}
