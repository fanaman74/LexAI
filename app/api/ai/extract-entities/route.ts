import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { getAnthropic, AI_MODEL } from "@/lib/ai/anthropic";

type RawEntity = { name: string; type: string; context?: string };
type RawRelation = { from: string; to: string; relation: string };
type AIResponse = { entities: RawEntity[]; relations: RawRelation[] };

const VALID_TYPES = new Set(["person", "organisation", "location", "date", "clause", "concept"]);

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { document_id } = await req.json().catch(() => ({}));
  if (!document_id) return NextResponse.json({ error: "document_id required" }, { status: 400 });

  const supabase = await createClient();

  // Verify ownership
  const { data: doc } = await supabase
    .from("documents")
    .select("id, original_filename")
    .eq("id", document_id)
    .eq("user_id", user.id)
    .single();
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  // Fetch up to 20 chunks for context
  const { data: chunks } = await supabase
    .from("document_chunks")
    .select("content, chunk_index")
    .eq("document_id", document_id)
    .order("chunk_index")
    .limit(20);

  if (!chunks || chunks.length === 0) {
    return NextResponse.json({ error: "No chunks found — document may not be processed yet" }, { status: 422 });
  }

  const text = chunks.map((c) => c.content).join("\n\n").slice(0, 14000);

  const client = getAnthropic();
  const msg = await client.chat.completions.create({
    model: AI_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "system",
        content: `You are a legal entity extractor. Extract all named entities and relationships from the document text.
Return ONLY valid JSON in this exact format:
{
  "entities": [
    {"name": "string", "type": "person|organisation|location|date|clause|concept", "context": "brief quote where this entity appears"}
  ],
  "relations": [
    {"from": "entity name", "to": "entity name", "relation": "short relation label e.g. works_for, party_to, signed_by, located_in, references"}
  ]
}
Rules:
- Only use the 6 allowed types
- Normalise names (e.g. "Mr. Smith" and "John Smith" should be the same entity)
- Only include relations where both entities appear in your entity list
- Keep relation labels short (2-4 words, snake_case)
- Aim for 10-30 entities and 5-20 relations`,
      },
      {
        role: "user",
        content: `Document: ${doc.original_filename}\n\n${text}`,
      },
    ],
  });

  const raw = msg.choices[0]?.message?.content ?? "";
  let parsed: AIResponse;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? raw);
  } catch {
    return NextResponse.json({ error: "AI returned invalid JSON", raw }, { status: 500 });
  }

  const { entities = [], relations = [] } = parsed;

  // Upsert entities and collect id map
  const entityIdMap: Record<string, string> = {};
  for (const e of entities) {
    const type = VALID_TYPES.has(e.type) ? e.type : "concept";
    const normalized = e.name.toLowerCase().trim();
    if (!normalized) continue;

    const { data: existing } = await supabase
      .from("entities")
      .select("id")
      .eq("user_id", user.id)
      .eq("normalized_name", normalized)
      .eq("type", type)
      .maybeSingle();

    let entityId: string;
    if (existing) {
      entityId = existing.id;
    } else {
      const { data: inserted } = await supabase
        .from("entities")
        .insert({ user_id: user.id, name: e.name.trim(), type, normalized_name: normalized })
        .select("id")
        .single();
      if (!inserted) continue;
      entityId = inserted.id;
    }

    entityIdMap[normalized] = entityId;
    entityIdMap[e.name.toLowerCase().trim()] = entityId;

    // Upsert mention
    await supabase.from("entity_mentions").upsert({
      entity_id: entityId,
      document_id,
      user_id: user.id,
      context: e.context?.slice(0, 500) ?? null,
    }, { onConflict: "entity_id,document_id" });
  }

  // Upsert relations
  let relationsStored = 0;
  for (const r of relations) {
    const fromId = entityIdMap[r.from.toLowerCase().trim()];
    const toId = entityIdMap[r.to.toLowerCase().trim()];
    if (!fromId || !toId || fromId === toId) continue;

    await supabase.from("entity_relations").upsert({
      user_id: user.id,
      from_entity_id: fromId,
      to_entity_id: toId,
      relation_type: r.relation.slice(0, 100),
      document_id,
    }, { onConflict: "from_entity_id,to_entity_id,relation_type,document_id" });
    relationsStored++;
  }

  return NextResponse.json({
    document_id,
    entities_found: entities.length,
    entities_stored: Object.keys(entityIdMap).length / 2,
    relations_stored: relationsStored,
  });
}
