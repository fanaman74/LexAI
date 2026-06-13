import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit/audit";
import { getAnthropic, AI_MODEL } from "@/lib/ai/anthropic";

const EMBED_SERVER_URL = process.env.EMBED_SERVER_URL ?? "http://localhost:8765";

async function embedQuestion(question: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${EMBED_SERVER_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: question, is_query: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.embedding ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { case_id, question } = body as { case_id?: string; question?: string };

  if (!case_id) return NextResponse.json({ error: "case_id required" }, { status: 400 });
  if (!question || question.trim().length < 5) {
    return NextResponse.json({ error: "question must be at least 5 characters" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: caseData, error: caseErr } = await supabase
    .from("cases")
    .select("id, name, status")
    .eq("id", case_id)
    .eq("user_id", user.id)
    .single();

  if (caseErr || !caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  // Get document IDs in this case
  const { data: caseDocs } = await supabase
    .from("case_documents")
    .select("document_id")
    .eq("case_id", case_id);

  if (!caseDocs || caseDocs.length === 0) {
    return NextResponse.json({ error: "Case has no documents" }, { status: 422 });
  }

  const caseDocIds = caseDocs.map((r: { document_id: string }) => r.document_id);

  type ChunkRow = { chunk_id: string; chunk_index: number; content: string; document_id: string };
  let chunks: ChunkRow[] = [];

  const embedding = await embedQuestion(question);
  if (embedding) {
    const { data: rpcChunks } = await supabase.rpc("match_document_chunks", {
      query_embedding: embedding,
      match_count: 12,
      filter_user_id: user.id,
      filter_case_id: case_id,
    });
    if (rpcChunks && rpcChunks.length > 0) {
      chunks = rpcChunks as ChunkRow[];
    }
  }

  if (chunks.length === 0) {
    // Fallback: fetch top 12 chunks across case documents in order
    const { data: fallbackChunks } = await supabase
      .from("document_chunks")
      .select("chunk_id, chunk_index, content, document_id")
      .in("document_id", caseDocIds)
      .order("chunk_index")
      .limit(12);
    chunks = (fallbackChunks ?? []) as ChunkRow[];
  }

  // Fetch document metadata for docs appearing in chunks
  const docIdsInChunks = [...new Set(chunks.map((c) => c.document_id))];
  const { data: docMetas } = await supabase
    .from("documents")
    .select("id, original_filename")
    .in("id", docIdsInChunks)
    .eq("user_id", user.id);

  const docMap: Record<string, string> = {};
  for (const d of docMetas ?? []) {
    docMap[d.id] = d.original_filename;
  }

  const contextString = chunks
    .map((c) => `[${docMap[c.document_id] ?? c.document_id}, Chunk ${c.chunk_index}] ${c.content}`)
    .join("\n\n");

  const client = getAnthropic();
  let answer: string;
  try {
    const msg = await client.chat.completions.create({
      model: AI_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: "system",
          content:
            "You are a legal analyst working on a case. Answer questions based ONLY on the provided document chunks. Always cite sources using [Document Name, Chunk N] notation at the end of your answer. List all sources used.",
        },
        {
          role: "user",
          content: `Case: ${caseData.name}\n\nContext from case documents:\n${contextString}\n\nQuestion: ${question}`,
        },
      ],
    });
    answer = msg.choices[0]?.message?.content ?? "";
  } catch (err) {
    console.error("AI ask-case error", err);
    return NextResponse.json({ error: "AI processing failed" }, { status: 500 });
  }

  await logAudit(supabase, user.id, "ai_ask", { case_id, metadata: { question } });

  return NextResponse.json({
    case_id,
    question,
    answer,
    chunks_used: chunks.map((c) => ({
      chunk_id: c.chunk_id,
      document_id: c.document_id,
      chunk_index: c.chunk_index,
      document_name: docMap[c.document_id] ?? null,
    })),
  });
}
