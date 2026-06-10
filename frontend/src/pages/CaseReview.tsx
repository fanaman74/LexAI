import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import type { FileRow } from "../api";

interface Analysis {
  id: number;
  file_ids: number[];
  prompt: string;
  response: string;
  model: string;
  created_at: string;
}

interface DocDetail {
  id: number;
  original_name: string;
  markdown: { content_md: string } | null;
}

const PRESETS = [
  { label: "Summarize", prompt: "Summarize each document in plain language, then give an overall summary." },
  { label: "Parties & Dates", prompt: "Extract all parties, roles, and key dates from these documents as a table." },
  { label: "Obligations & Deadlines", prompt: "List every obligation and deadline, who bears it, and the source clause." },
  { label: "Risk Flags", prompt: "Identify clauses that pose legal risk or unusual obligations. Flag each with severity (high/medium/low) and explain why." },
  { label: "Precedent Search", prompt: "Find references to case law, statutes, or precedents in these documents. List each reference with its context." },
];

export default function CaseReview() {
  const [params] = useSearchParams();
  const initialIds = (params.get("ids") ?? "").split(",").filter(Boolean).map(Number);

  const [caseName, setCaseName] = useState("Untitled Case");
  const [allFiles, setAllFiles] = useState<FileRow[]>([]);
  const [pinnedIds, setPinnedIds] = useState<number[]>(initialIds);
  const [searchQ, setSearchQ] = useState("");
  const [activeDocId, setActiveDocId] = useState<number | null>(initialIds[0] ?? null);
  const [docCache, setDocCache] = useState<Record<number, DocDetail>>({});
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Analysis[]>([]);

  useEffect(() => {
    api<{ files: FileRow[] }>("/api/files")
      .then(({ files }) => setAllFiles(files))
      .catch(() => {});
    api<{ analyses: Analysis[] }>("/api/analyses")
      .then(({ analyses }) => setHistory(analyses))
      .catch(() => {});
  }, []);

  const docCacheRef = useRef(docCache);
  docCacheRef.current = docCache;

  const loadDoc = useCallback(
    async (id: number) => {
      if (docCacheRef.current[id]) return;
      try {
        const doc = await api<DocDetail>(`/api/files/${id}`);
        setDocCache((c) => ({ ...c, [id]: doc }));
      } catch { /* ignore */ }
    },
    [],
  );

  useEffect(() => {
    if (activeDocId !== null) loadDoc(activeDocId);
  }, [activeDocId, loadDoc]);

  function pin(id: number) {
    if (pinnedIds.includes(id)) return;
    setPinnedIds((p) => [...p, id]);
    setActiveDocId(id);
  }

  function unpin(id: number) {
    const next = pinnedIds.filter((x) => x !== id);
    setPinnedIds(next);
    if (activeDocId === id) setActiveDocId(next[0] ?? null);
  }

  async function runAnalysis() {
    if (!prompt.trim() || pinnedIds.length === 0) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const res = await api<{ response: string }>("/api/analyses", {
        method: "POST",
        body: JSON.stringify({ file_ids: pinnedIds, prompt }),
      });
      setResult(res.response);
      setHistory((h) => [
        {
          id: Date.now(),
          file_ids: pinnedIds,
          prompt,
          response: res.response,
          model: "",
          created_at: new Date().toISOString(),
        },
        ...h,
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = allFiles.filter((f) =>
    f.original_name.toLowerCase().includes(searchQ.toLowerCase()),
  );
  const pinnedFiles = allFiles.filter((f) => pinnedIds.includes(f.id));
  const activeDoc = activeDocId !== null ? docCache[activeDocId] : null;

  return (
    <div className="flex flex-col lg:flex-row min-h-screen overflow-hidden">
      {/* Left panel — document picker */}
      <div className="w-full lg:w-72 shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <input
            value={caseName}
            onChange={(e) => setCaseName(e.target.value)}
            className="w-full text-sm font-semibold border-0 border-b border-zinc-700 pb-1 focus:outline-none focus:border-amber-500 bg-transparent text-white"
          />
        </div>
        <div className="p-3 border-b border-zinc-800">
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search files…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.slice(0, 50).map((f) => (
            <button
              key={f.id}
              onClick={() => pin(f.id)}
              disabled={pinnedIds.includes(f.id)}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-zinc-800 disabled:opacity-40 border-b border-zinc-800/60"
            >
              <span className="font-medium text-zinc-200 block truncate">{f.original_name}</span>
              <span className="text-xs text-zinc-500 uppercase">{f.file_type}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-zinc-500 p-4">No files match.</p>
          )}
        </div>
        {pinnedFiles.length > 0 && (
          <div className="border-t border-zinc-800 p-3 shrink-0">
            <p className="text-xs font-semibold text-zinc-500 mb-2">
              PINNED ({pinnedFiles.length})
            </p>
            {pinnedFiles.map((f) => (
              <div key={f.id} className="flex items-center gap-1 mb-1">
                <button
                  onClick={() => setActiveDocId(f.id)}
                  className={`flex-1 text-left text-xs truncate rounded px-2 py-1 ${
                    activeDocId === f.id
                      ? "bg-amber-500/10 text-amber-400"
                      : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {f.original_name}
                </button>
                <button
                  onClick={() => unpin(f.id)}
                  className="text-zinc-600 hover:text-red-400 px-1 text-base leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Center panel — document reader */}
      <div className="flex-1 min-w-0 flex flex-col bg-zinc-950 overflow-hidden">
        {pinnedFiles.length > 0 ? (
          <>
            <div className="flex border-b border-zinc-800 bg-zinc-900 overflow-x-auto shrink-0">
              {pinnedFiles.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setActiveDocId(f.id)}
                  className={`px-4 py-2.5 text-sm font-medium shrink-0 border-r border-zinc-800 transition-colors ${
                    activeDocId === f.id
                      ? "bg-amber-500/10 text-amber-400 border-b-2 border-b-amber-500"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {f.original_name.length > 24
                    ? f.original_name.slice(0, 24) + "…"
                    : f.original_name}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {activeDoc ? (
                activeDoc.markdown ? (
                  <div className="prose prose-invert max-w-none bg-zinc-900 rounded-xl border border-zinc-800 p-6">
                    <ReactMarkdown>{activeDoc.markdown.content_md}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
                    Document not yet converted.
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
                  {activeDocId !== null ? "Loading…" : "Select a pinned document"}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
            Pin documents from the left panel to start reading
          </div>
        )}
      </div>

      {/* Right panel — analysis tools */}
      <div className="w-full lg:w-80 shrink-0 bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-zinc-800 shrink-0">
          <h2 className="font-semibold text-zinc-200 mb-3">AI Analysis</h2>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setPrompt(p.prompt)}
                className="border border-zinc-700 text-zinc-300 rounded-full px-3 py-1 text-xs hover:bg-zinc-800 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Ask a question about the pinned documents…"
            className="bg-zinc-800 border border-zinc-700 rounded-lg w-full px-3 py-2 text-sm resize-none text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={runAnalysis}
            disabled={busy || pinnedIds.length === 0 || !prompt.trim()}
            className="mt-2 w-full bg-emerald-600 disabled:bg-zinc-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            {busy
              ? "Analyzing…"
              : `Run Analysis (${pinnedIds.length} doc${pinnedIds.length !== 1 ? "s" : ""})`}
          </button>
          {error && <p className="text-red-400 mt-2 text-xs">{error}</p>}
        </div>

        <div className="flex-1 overflow-y-auto">
          {result && (
            <div className="p-4 border-b border-zinc-800">
              <p className="text-xs font-semibold text-zinc-500 mb-2">RESULT</p>
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>
            </div>
          )}
          <div className="p-4">
            <h3 className="text-xs font-semibold text-zinc-500 mb-2">HISTORY</h3>
            {history.length === 0 && (
              <p className="text-xs text-zinc-500">No analyses yet.</p>
            )}
            {history.map((a) => (
              <details key={a.id} className="border-b border-zinc-800/60 py-1.5">
                <summary className="cursor-pointer text-xs text-zinc-400">
                  {a.prompt.slice(0, 60)}
                  {a.prompt.length > 60 ? "…" : ""}
                </summary>
                <div className="prose prose-invert prose-sm max-w-none mt-2">
                  <ReactMarkdown>{a.response}</ReactMarkdown>
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
