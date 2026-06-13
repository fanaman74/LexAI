"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  documentId: string;
  hasMarkdown: boolean;
};

export function DocumentActions({ documentId, hasMarkdown }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [reconstructed, setReconstructed] = useState<string | null>(null);

  // AI state
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiAskOpen, setAiAskOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  async function viewOriginal() {
    setLoading("original");
    try {
      const res = await fetch(`/api/documents/${documentId}/signed-url`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to get URL");
      window.open(data.url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function viewMarkdown() {
    setLoading("markdown");
    try {
      const res = await fetch(`/api/documents/${documentId}/signed-url?kind=markdown`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to get URL");
      window.open(data.url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function reconstruct() {
    setLoading("reconstruct");
    try {
      const res = await fetch(`/api/documents/${documentId}/reconstruct`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to reconstruct");
      setReconstructed(data.markdown ?? JSON.stringify(data));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function reprocess() {
    setLoading("reprocess");
    try {
      const res = await fetch(`/api/documents/${documentId}/reprocess`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to reprocess");
      }
      router.refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function deleteDoc() {
    if (!confirm("Delete this document?")) return;
    setLoading("delete");
    try {
      const res = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete");
      }
      router.push("/documents");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
      setLoading(null);
    }
  }

  async function summariseWithAI() {
    setAiLoading("summarise");
    setAiError(null);
    try {
      const res = await fetch("/api/ai/document-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: documentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI summarisation failed");
      router.refresh();
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(null);
    }
  }

  async function askAI(e: React.FormEvent) {
    e.preventDefault();
    if (!aiQuestion.trim()) return;
    setAiLoading("ask");
    setAiError(null);
    setAiAnswer(null);
    try {
      const res = await fetch("/api/ai/ask-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: documentId, question: aiQuestion }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI question failed");
      setAiAnswer(data.answer ?? "No answer returned");
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(null);
    }
  }

  const btnCls = "rounded border px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50";

  return (
    <div>
      <div className="flex gap-2 flex-wrap">
        <button className={btnCls} onClick={viewOriginal} disabled={loading !== null}>
          {loading === "original" ? "Loading…" : "View original"}
        </button>
        {hasMarkdown && (
          <button className={btnCls} onClick={viewMarkdown} disabled={loading !== null}>
            {loading === "markdown" ? "Loading…" : "View markdown"}
          </button>
        )}
        <button className={btnCls} onClick={reconstruct} disabled={loading !== null}>
          {loading === "reconstruct" ? "Loading…" : "Reconstruct"}
        </button>
        <button className={btnCls} onClick={reprocess} disabled={loading !== null}>
          {loading === "reprocess" ? "Loading…" : "Reprocess"}
        </button>
        <button
          className={btnCls + " text-purple-700 hover:bg-purple-50"}
          onClick={summariseWithAI}
          disabled={aiLoading !== null || loading !== null}
        >
          {aiLoading === "summarise" ? "Summarising…" : "Summarise with AI"}
        </button>
        <button
          className={btnCls + " text-blue-700 hover:bg-blue-50"}
          onClick={() => { setAiAskOpen((v) => !v); setAiAnswer(null); setAiError(null); }}
          disabled={loading !== null}
        >
          Ask AI
        </button>
        <button
          className={btnCls + " text-red-600 hover:bg-red-50"}
          onClick={deleteDoc}
          disabled={loading !== null}
        >
          {loading === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>

      {aiAskOpen && (
        <form onSubmit={askAI} className="mt-3 flex gap-2 items-start">
          <textarea
            className="flex-1 rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-y min-h-[60px]"
            placeholder="Ask a question about this document…"
            value={aiQuestion}
            onChange={(e) => setAiQuestion(e.target.value)}
            rows={2}
          />
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={aiLoading === "ask" || !aiQuestion.trim()}
          >
            {aiLoading === "ask" ? "Asking…" : "Ask"}
          </button>
        </form>
      )}

      {aiError && (
        <p className="mt-2 text-sm text-red-600">{aiError}</p>
      )}

      {aiAnswer !== null && (
        <details open className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-blue-700">AI Answer</summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-700 max-h-96 overflow-y-auto rounded border p-3 bg-blue-50">
            {aiAnswer}
          </pre>
        </details>
      )}

      {reconstructed !== null && (
        <details open className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">Reconstructed markdown</summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-700 max-h-96 overflow-y-auto rounded border p-3 bg-gray-50">
            {reconstructed}
          </pre>
        </details>
      )}
    </div>
  );
}
