import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const documentId = searchParams.get("document_id");
  const caseId = searchParams.get("case_id");

  const supabase = await createClient();

  let documentIds: string[] = [];

  if (documentId) {
    // Verify ownership
    const { data } = await supabase.from("documents").select("id").eq("id", documentId).eq("user_id", user.id).single();
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    documentIds = [documentId];
  } else if (caseId) {
    const { data } = await supabase.from("case_documents").select("document_id").eq("case_id", caseId);
    documentIds = (data ?? []).map((r: { document_id: string }) => r.document_id);
  } else {
    // Return full graph for user (capped)
    const { data } = await supabase.from("entity_mentions").select("document_id").eq("user_id", user.id);
    documentIds = [...new Set((data ?? []).map((r: { document_id: string }) => r.document_id))];
  }

  if (documentIds.length === 0) return NextResponse.json({ nodes: [], edges: [] });

  // Fetch entity mentions for these documents
  const { data: mentions } = await supabase
    .from("entity_mentions")
    .select("entity_id, document_id, context, entities(id, name, type)")
    .in("document_id", documentIds)
    .eq("user_id", user.id);

  // Fetch relations where source doc is in scope
  const { data: relations } = await supabase
    .from("entity_relations")
    .select("id, from_entity_id, to_entity_id, relation_type, document_id")
    .in("document_id", documentIds)
    .eq("user_id", user.id);

  // Build node set from mentions
  const nodeMap: Record<string, { id: string; name: string; type: string; documents: string[] }> = {};
  for (const m of mentions ?? []) {
    const raw = m.entities;
    const e = (Array.isArray(raw) ? raw[0] : raw) as { id: string; name: string; type: string } | null;
    if (!e) continue;
    if (!nodeMap[e.id]) {
      nodeMap[e.id] = { id: e.id, name: e.name, type: e.type, documents: [] };
    }
    if (!nodeMap[e.id].documents.includes(m.document_id)) {
      nodeMap[e.id].documents.push(m.document_id);
    }
  }

  const edges = (relations ?? [])
    .filter((r) => nodeMap[r.from_entity_id] && nodeMap[r.to_entity_id])
    .map((r) => ({
      id: r.id,
      source: r.from_entity_id,
      target: r.to_entity_id,
      label: r.relation_type,
      document_id: r.document_id,
    }));

  return NextResponse.json({ nodes: Object.values(nodeMap), edges });
}
