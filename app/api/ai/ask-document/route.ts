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
  const { document_id, question } = body as { document_id?: string; question?: string };

  if (!document_id) return NextResponse.json({ error: "document_id required" }, { status: 400 });
  if (!question || question.trim().length < 5) {
    return NextResponse.json({ error: "question must be at least 5 characters" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, original_filename, source_type")
    .eq("id", document_id)
    .eq("user_id", user.id)
    .single();

  if (docErr || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  // Try vector similarity search; fall back to ordered chunks
  let chunks: Array<{ chunk_id: string; chunk_index: number; content: string; document_id?: string }> = [];

  const embedding = await embedQuestion(question);
  if (embedding) {
    const { data: rpcChunks } = await supabase.rpc("match_document_chunks", {
      query_embedding: embedding,
      match_count: 8,
      filter_user_id: user.id,
      filter_case_id: null,
    });
    if (rpcChunks && rpcChunks.length > 0) {
      chunks = (rpcChunks as Array<{ chunk_id: string; chunk_index: number; content: string; document_id: string }>)
        .filter((c) => c.document_id === document_id);
    }
  }

  if (chunks.length === 0) {
    const { data: fallbackChunks } = await supabase
      .from("document_chunks")
      .select("chunk_id, chunk_index, content")
      .eq("document_id", document_id)
      .order("chunk_index")
      .limit(10);
    chunks = fallbackChunks ?? [];
  }

  const contextString = chunks
    .map((c) => `[Chunk ${c.chunk_index}] ${c.content}`)
    .join("\n\n");

  const anthropic = getAnthropic();
  let answer: string;
  try {
    const msg = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      system:
        "You are a legal document analyst. Answer questions based ONLY on the provided document chunks. Always cite the specific chunks you used in your answer using [Chunk N] notation. If the answer cannot be found in the provided chunks, say so explicitly.",
      messages: [{
        role: "user",
        content: `Document: ${doc.original_filename} (${doc.source_type})\n\nContext chunks:\n${contextString}\n\nQuestion: ${question}`,
      }],
    });
    answer = msg.content[0].type === "text" ? msg.content[0].text : "";
  } catch (err) {
    console.error("AI ask-document error", err);
    return NextResponse.json({ error: "AI processing failed" }, { status: 500 });
  }

  await logAudit(supabase, user.id, "ai_ask", { document_id, metadata: { question } });

  return NextResponse.json({
    document_id,
    question,
    answer,
    chunks_used: chunks.map((c) => ({ chunk_id: c.chunk_id, chunk_index: c.chunk_index })),
  });
}
