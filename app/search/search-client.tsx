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
      style={{
        borderRadius: "4px",
        border: "1px solid #2a2a2a",
        padding: "4px 12px",
        fontSize: "12px",
        color: "#9ca3af",
        background: "transparent",
        cursor: "pointer",
      }}
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

  const inputStyle: React.CSSProperties = {
    background: "#171717",
    border: "1px solid #2a2a2a",
    borderRadius: "6px",
    padding: "8px 12px",
    color: "#ffffff",
    fontSize: "13px",
    outline: "none",
  };

  const selectStyle: React.CSSProperties = {
    background: "#171717",
    border: "1px solid #2a2a2a",
    borderRadius: "6px",
    padding: "6px 10px",
    color: "#9ca3af",
    fontSize: "13px",
    outline: "none",
  };

  return (
    <div>
      <form onSubmit={handleSearch}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents..."
          style={{ ...inputStyle, width: "100%", marginBottom: "12px", boxSizing: "border-box" }}
        />

        {/* Mode selector */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
          {(["hybrid", "keyword", "semantic"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                borderRadius: "6px",
                padding: "6px 14px",
                fontSize: "13px",
                border: mode === m ? "1px solid #f59e0b" : "1px solid #2a2a2a",
                background: mode === m ? "rgba(245,158,11,0.1)" : "transparent",
                color: mode === m ? "#f59e0b" : "#9ca3af",
                cursor: "pointer",
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Filters row */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "12px" }}>
          <select
            value={caseId ?? ""}
            onChange={(e) => setCaseId(e.target.value || undefined)}
            style={selectStyle}
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
              style={selectStyle}
            >
              <option value="">All types</option>
              {["pdf", "docx", "xlsx", "eml", "msg", "email_attachment"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            background: "#f59e0b",
            color: "#000",
            fontWeight: 600,
            padding: "8px 20px",
            borderRadius: "6px",
            border: "none",
            fontSize: "13px",
            cursor: "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <p style={{ marginTop: "16px", color: "#ef4444", fontSize: "13px" }}>{error}</p>
      )}
      {loading && (
        <p style={{ marginTop: "16px", fontSize: "13px", color: "#9ca3af" }}>Searching…</p>
      )}
      {results.length === 0 && !loading && !error && responseMode !== null && (
        <p style={{ marginTop: "16px", fontSize: "13px", color: "#9ca3af" }}>No results found.</p>
      )}
      {responseMode && responseMode !== mode && (
        <p style={{ marginTop: "8px", fontSize: "12px", color: "#f59e0b" }}>
          Ran as {responseMode} (embed server may be down)
        </p>
      )}

      <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {results.map((r) => (
          <div
            key={r.document_id}
            style={{
              background: "#171717",
              border: "1px solid #2a2a2a",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <a
                  href={`/documents/${r.document_id}`}
                  style={{ fontWeight: 500, color: "#f59e0b", textDecoration: "none", fontSize: "14px" }}
                >
                  {r.display_title ?? r.original_filename}
                </a>
                <span style={{ marginLeft: "8px", fontSize: "11px", color: "#9ca3af" }}>
                  {r.source_type}
                </span>
                {r.document_date && (
                  <span style={{ marginLeft: "8px", fontSize: "11px", color: "#9ca3af" }}>
                    {r.document_date}
                  </span>
                )}
              </div>
              <span style={{ fontSize: "12px", fontFamily: "monospace", color: "#9ca3af" }}>
                {(r.best_score * 100).toFixed(1)}%
              </span>
            </div>

            {r.ai_short_summary && (
              <p style={{ marginTop: "6px", fontSize: "13px", color: "#9ca3af" }}>{r.ai_short_summary}</p>
            )}

            {r.snippet && (
              <p
                style={{
                  marginTop: "8px",
                  fontSize: "13px",
                  color: "#d1d5db",
                  background: "rgba(245,158,11,0.08)",
                  borderRadius: "4px",
                  padding: "6px 8px",
                }}
                dangerouslySetInnerHTML={{ __html: sanitizeSnippet(r.snippet) }}
              />
            )}

            {r.matched_chunks && r.matched_chunks.length > 0 && (
              <details style={{ marginTop: "8px" }}>
                <summary style={{ fontSize: "12px", color: "#9ca3af", cursor: "pointer" }}>
                  {r.matched_chunks.length} matched chunk
                  {r.matched_chunks.length > 1 ? "s" : ""}
                </summary>
                <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  {r.matched_chunks.map((mc) => (
                    <div
                      key={mc.chunk_id}
                      style={{
                        fontSize: "12px",
                        background: "#1f1f1f",
                        borderRadius: "4px",
                        padding: "8px",
                      }}
                    >
                      <span style={{ fontFamily: "monospace", color: "#9ca3af" }}>
                        chunk {mc.chunk_index}
                      </span>
                      <span style={{ marginLeft: "8px", color: "#9ca3af" }}>
                        {(mc.similarity * 100).toFixed(1)}%
                      </span>
                      <p style={{ marginTop: "4px", color: "#d1d5db" }}>{mc.content_preview}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
              <a
                href={`/documents/${r.document_id}`}
                style={{
                  borderRadius: "4px",
                  border: "1px solid #2a2a2a",
                  padding: "4px 12px",
                  fontSize: "12px",
                  color: "#9ca3af",
                  textDecoration: "none",
                }}
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
