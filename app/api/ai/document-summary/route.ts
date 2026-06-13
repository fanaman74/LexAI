import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit/audit";
import { getAnthropic, AI_MODEL } from "@/lib/ai/anthropic";

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { document_id } = body as { document_id?: string };
  if (!document_id) return NextResponse.json({ error: "document_id required" }, { status: 400 });

  const supabase = await createClient();

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, original_filename, display_title, source_type, extracted_text, ai_short_summary, ai_long_summary")
    .eq("id", document_id)
    .eq("user_id", user.id)
    .single();

  if (docErr || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  if (!doc.extracted_text || doc.extracted_text.trim() === "") {
    return NextResponse.json({ error: "Document has no extracted text" }, { status: 422 });
  }

  const truncatedText = doc.extracted_text.slice(0, 12000);

  let parsed: { ai_short_summary?: string; ai_long_summary?: string; ai_keywords?: string[] };
  try {
    const anthropic = getAnthropic();
    const msg = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `You are a legal document analyst. Analyse the following document and provide:
1. A one-sentence summary (ai_short_summary): concise description of what the document is.
2. A detailed summary (ai_long_summary): 2-4 paragraphs covering the key facts, parties, dates, and legal significance.
3. Keywords: 5-10 key legal terms or topics as a JSON array of strings.

Document name: ${doc.original_filename}
Document type: ${doc.source_type}

Document text:
${truncatedText}

Respond ONLY with valid JSON in this exact format:
{
  "ai_short_summary": "...",
  "ai_long_summary": "...",
  "ai_keywords": ["keyword1", "keyword2"]
}`,
      }],
    });

    const rawText = msg.content[0].type === "text" ? msg.content[0].text : "{}";
    // Strip markdown code fences if present
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("AI summary error", err);
    return NextResponse.json({ error: "AI processing failed" }, { status: 500 });
  }

  const { ai_short_summary, ai_long_summary, ai_keywords } = parsed;

  const { error: updateErr } = await supabase
    .from("documents")
    .update({
      ai_short_summary: ai_short_summary ?? null,
      ai_long_summary: ai_long_summary ?? null,
      ai_keywords: ai_keywords ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", document_id)
    .eq("user_id", user.id);

  if (updateErr) {
    console.error("Failed to update document with AI summary", updateErr);
    return NextResponse.json({ error: "Failed to save summary" }, { status: 500 });
  }

  await logAudit(supabase, user.id, "ai_summary", { document_id });

  return NextResponse.json({ document_id, ai_short_summary, ai_long_summary, ai_keywords });
}
