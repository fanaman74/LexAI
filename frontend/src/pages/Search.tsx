import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { searchDocuments } from "../api";
import type { SearchResult } from "../api";

const TYPE_BADGE: Record<string, string> = {
  pdf:  "bg-red-900/50 text-red-400",
  docx: "bg-blue-900/50 text-blue-400",
  doc:  "bg-blue-900/50 text-blue-400",
  xlsx: "bg-green-900/50 text-green-400",
  csv:  "bg-green-900/50 text-green-400",
  msg:  "bg-purple-900/50 text-purple-400",
  eml:  "bg-purple-900/50 text-purple-400",
};

function ResultCard({ result }: { result: SearchResult }) {
  const [showNeighbors, setShowNeighbors] = useState(false);
  const badge = TYPE_BADGE[result.file_type] ?? "bg-zinc-800 text-zinc-400";

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
      {/* Top row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${badge}`}>
          {result.file_type}
        </span>
        <span className="font-medium text-zinc-100 text-sm">{result.original_filename}</span>
        {result.page_number != null && (
          <span className="text-xs text-zinc-500">p.{result.page_number}</span>
        )}
        {result.section_title && (
          <span className="text-xs text-amber-400/70 italic">{result.section_title}</span>
        )}
      </div>

      {/* Chunk text */}
      <blockquote className="border-l-2 border-amber-500 pl-3 text-sm text-zinc-400 italic leading-relaxed">
        {result.chunk_text}
      </blockquote>

      {/* Score badges */}
      <div className="flex flex-wrap gap-1.5">
        <span className="text-[11px] bg-zinc-800 text-zinc-400 rounded-full px-2 py-0.5">
          vec {result.vec_score.toFixed(3)}
        </span>
        <span className="text-[11px] bg-zinc-800 text-zinc-400 rounded-full px-2 py-0.5">
          fts {result.fts_score.toFixed(3)}
        </span>
        <span className="text-[11px] bg-amber-500/10 text-amber-400 rounded-full px-2 py-0.5">
          rrf {result.rrf_score.toFixed(4)}
        </span>
      </div>

      {/* Keywords */}
      {result.doc_keywords?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {result.doc_keywords.map((kw) => (
            <span key={kw} className="text-[11px] bg-zinc-800 text-zinc-600 rounded-full px-2 py-0.5">
              {kw}
            </span>
          ))}
        </div>
      )}

      {/* Neighbors */}
      {result.neighbors?.length > 0 && (
        <div>
          <button
            onClick={() => setShowNeighbors((v) => !v)}
            className="text-xs text-zinc-500 hover:text-amber-400 transition-colors"
          >
            {showNeighbors ? "Hide context ▲" : `Show context (${result.neighbors.length} chunks) ▼`}
          </button>
          {showNeighbors && (
            <div className="mt-2 space-y-2 pl-3 border-l border-zinc-700">
              {result.neighbors.map((n) => (
                <div key={n.chunk_index}>
                  {n.page_number != null && (
                    <span className="text-[11px] text-zinc-600 mr-1">p.{n.page_number}</span>
                  )}
                  <p className="text-xs text-zinc-500 leading-relaxed inline">{n.chunk_text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="pt-1">
        <Link to="/library" className="text-xs text-amber-400/70 hover:text-amber-400 hover:underline transition-colors">
          Open document →
        </Link>
      </div>
    </div>
  );
}

export default function Search() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [fileType, setFileType] = useState("");
  const [limit, setLimit] = useState(20);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [lastQuery, setLastQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function runSearch(overrideQ?: string) {
    const query = (overrideQ ?? q).trim();
    if (!query) return;
    setLoading(true);
    setError("");
    setResults(null);
    setLastQuery(query);
    try {
      const res = await searchDocuments(query, {
        file_type: fileType || undefined,
        limit,
      });
      setResults(res.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const hasSearched = results !== null || loading || error !== "";

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* Search bar */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          placeholder="Search across all documents…"
          className="flex-1 border border-zinc-700 rounded-lg px-4 py-3 bg-zinc-900 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 text-base"
        />
        <button
          onClick={() => runSearch()}
          disabled={loading || !q.trim()}
          className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-black rounded-lg px-5 font-medium transition-colors flex items-center gap-2"
        >
          {loading ? (
            <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          )}
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {/* Filters row — shown after first search */}
      {hasSearched && (
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={fileType}
            onChange={(e) => setFileType(e.target.value)}
            className="border border-zinc-700 rounded-lg px-3 py-1.5 bg-zinc-900 text-zinc-300 text-sm focus:outline-none focus:border-amber-500"
          >
            <option value="">All types</option>
            <option value="pdf">PDF</option>
            <option value="docx">DOCX</option>
            <option value="eml">Email</option>
            <option value="csv">CSV</option>
          </select>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="border border-zinc-700 rounded-lg px-3 py-1.5 bg-zinc-900 text-zinc-300 text-sm focus:outline-none focus:border-amber-500"
          >
            <option value={10}>10 results</option>
            <option value={20}>20 results</option>
            <option value={50}>50 results</option>
          </select>
          {results !== null && (
            <span className="text-sm text-zinc-500 ml-auto">
              {results.length} result{results.length !== 1 ? "s" : ""} for &ldquo;{lastQuery}&rdquo;
            </span>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <p className="text-red-400 bg-red-950/50 border border-red-800/50 rounded-lg px-4 py-3 text-sm">{error}</p>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center py-16">
          <svg className="w-8 h-8 animate-spin text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
      )}

      {/* Empty state */}
      {!loading && results !== null && results.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-zinc-500">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12 text-amber-400/40">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <p className="text-base">No results for &ldquo;{lastQuery}&rdquo;</p>
          <p className="text-sm text-zinc-600">Try different keywords or remove filters</p>
        </div>
      )}

      {/* Results */}
      {!loading && results !== null && results.length > 0 && (
        <div className="space-y-3">
          {results.map((r) => (
            <ResultCard key={r.chunk_id} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}
