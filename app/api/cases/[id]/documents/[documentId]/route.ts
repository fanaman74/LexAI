import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/audit";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, documentId } = await params;
  const supabase = await createClient();

  const { error } = await supabase
    .from("case_documents")
    .delete()
    .eq("case_id", id)
    .eq("document_id", documentId)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit(supabase, user.id, "case_unassign", { case_id: id, document_id: documentId });

  return NextResponse.json({ removed: true });
}
