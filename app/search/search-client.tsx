"use client";

import { useState } from "react";

type Case = { id: string; name: string };
type SearchResult = {
  document_id: string;
  original_filename: string;
  display_title: string | null;
  source_type: string;
  document_date: string | null;
  ai_short_summary: string | null;
  best_score: number;
  keyword_score?: number;
  semantic_score?: number;
  matched_chunks?: Array<{
    chunk_id: string;
    chunk_index: number;
    similarity: number;
    content_preview: string;
  }>;
  snippet?: string | null;
};

function sanitizeSnippet(snippet: string): string {
  return snippet.replace(/<(?!\/?b>)[^>]*>/g, "");
}

function ViewOriginalButton({ documentId }: { documentId: string }) {
  const [loading, setLoading] = useState(false);
  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/signed-url`);
      const data = await res.json();
      if (data.url) window.open(data.url, "_blank");
    } finally {
      setLoading(false);
    }
  }
  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="rounded border px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
    >
      {loading ? "Loading…" : "View original"}
    </button>
  );
}

export function SearchClient({
  cases,
  initialCaseId,
}: {
  cases: Case[];
  initialCaseId?: string;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"keyword" | "semantic" | "hybrid">("hybrid");
  const [caseId, setCaseId] = useState<string | undefined>(initialCaseId);
  const [sourceType, setSourceType] = useState<string | undefined>(undefined);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responseMode, setResponseMode] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) {
      setError("Query must be at least 2 characters");
      return;
    }
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const body: Record<string, unknown> = { query: query.trim(), limit: 20 };
      if (caseId) body.case_id = caseId;
      if (sourceType && mode !== "semantic") body.source_type = sourceType;
      const res = await fetch(`/api/search/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Search failed");
        return;
      }
      setResults(data.results ?? []);
      setResponseMode(data.mode ?? mode);
    } catch {
      setError("Search unavailable. Is the embed server running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSearch}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents..."
          className="w-full rounded border px-3 py-2 text-sm mb-3"
        />

        {/* Mode selector */}
        <div className="flex gap-1 mb-3">
          {(["hybrid", "keyword", "semantic"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1 text-sm border ${
                mode === m ? "bg-gray-900 text-white" : "hover:bg-gray-50"
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Filters row */}
        <div className="flex gap-3 mb-3 text-sm">
          <select
            value={caseId ?? ""}
            onChange={(e) => setCaseId(e.target.value || undefined)}
            className="rounded border px-2 py-1"
          >
            <option value="">All cases</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {mode !== "semantic" && (
            <select
              value={sourceType ?? ""}
              onChange={(e) => setSourceType(e.target.value || undefined)}
              className="rounded border px-2 py-1"
            >
              <option value="">All types</option>
              {["pdf", "docx", "xlsx", "eml", "msg", "email_attachment"].map(
                (t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                )
              )}
            </select>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded bg-gray-900 text-white px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="mt-4 text-red-600 text-sm">{error}</p>}
      {loading && <p className="mt-4 text-sm text-gray-500">Searching…</p>}
      {results.length === 0 && !loading && !error && responseMode !== null && (
        <p className="mt-4 text-sm text-gray-500">No results found.</p>
      )}
      {responseMode && responseMode !== mode && (
        <p className="mt-2 text-xs text-amber-600">
          Ran as {responseMode} (embed server may be down)
        </p>
      )}

      <div className="mt-6 space-y-4">
        {results.map((r) => (
          <div key={r.document_id} className="rounded border p-4">
            <div className="flex items-start justify-between">
              <div>
                <a
                  href={`/documents/${r.document_id}`}
                  className="font-medium text-blue-600 hover:underline"
                >
                  {r.display_title ?? r.original_filename}
                </a>
                <span className="ml-2 text-xs text-gray-400">
                  {r.source_type}
                </span>
                {r.document_date && (
                  <span className="ml-2 text-xs text-gray-400">
                    {r.document_date}
                  </span>
                )}
              </div>
              <span className="text-sm font-mono text-gray-600">
                {(r.best_score * 100).toFixed(1)}%
              </span>
            </div>

            {r.ai_short_summary && (
              <p className="mt-1 text-sm text-gray-600">{r.ai_short_summary}</p>
            )}

            {r.snippet && (
              <p
                className="mt-2 text-sm text-gray-700 bg-yellow-50 rounded px-2 py-1"
                dangerouslySetInnerHTML={{ __html: sanitizeSnippet(r.snippet) }}
              />
            )}

            {/* Matched chunks for semantic/hybrid */}
            {r.matched_chunks && r.matched_chunks.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-gray-400 cursor-pointer">
                  {r.matched_chunks.length} matched chunk
                  {r.matched_chunks.length > 1 ? "s" : ""}
                </summary>
                <div className="mt-1 space-y-1">
                  {r.matched_chunks.map((mc) => (
                    <div key={mc.chunk_id} className="text-xs rounded bg-gray-50 p-2">
                      <span className="font-mono text-gray-400">
                        chunk {mc.chunk_index}
                      </span>
                      <span className="ml-2 text-gray-400">
                        {(mc.similarity * 100).toFixed(1)}%
                      </span>
                      <p className="mt-0.5 text-gray-600">{mc.content_preview}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="mt-3 flex gap-2">
              <a
                href={`/documents/${r.document_id}`}
                className="rounded border px-3 py-1 text-xs hover:bg-gray-50"
              >
                Open document
              </a>
              <ViewOriginalButton documentId={r.document_id} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
