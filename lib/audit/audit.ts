import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditAction } from "@/lib/types";

export async function logAudit(
  supabase: SupabaseClient,
  userId: string,
  action: AuditAction,
  opts: { document_id?: string; case_id?: string; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    user_id: userId,
    action,
    document_id: opts.document_id ?? null,
    case_id: opts.case_id ?? null,
    metadata: opts.metadata ?? {},
  });
  if (error) console.error("audit_log insert failed", error.message);
}
