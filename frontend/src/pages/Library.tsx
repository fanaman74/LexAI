import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Case, FileRow, FolderEntry, IndexStatus, ScanProgress, SemanticResult } from "../api";
import Bubble from "../components/Bubble";

const FILE_TYPES = ["pdf", "docx", "doc", "msg", "eml", "xlsx", "csv", "txt", "rtf"];
const STATUSES = ["converted", "pending", "failed", "needs_ocr"];

function fmtSize(n: number) {
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n > 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

const statusPill = (s: string) =>
  s === "converted" ? "bg-emerald-900/50 text-emerald-400" :
  s === "failed" ? "bg-red-900/50 text-red-400" : "bg-amber-900/50 text-amber-400";

export default function Library() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);
  const [activeFolders, setActiveFolders] = useState<string[]>([]);
  const [activeCaseIds, setActiveCaseIds] = useState<number[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"keyword" | "semantic">("keyword");
  const [semantic, setSemantic] = useState<SemanticResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [scan] = useState<ScanProgress | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [summariseProgress, setSummariseProgress] = useState<{ running: boolean; done: number; total: number; errors: number } | null>(null);
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [expandedMd, setExpandedMd] = useState<number | null>(null);
  const [mdContent, setMdContent] = useState<Record<number, string>>({});
  const indexPollRef = useRef<number | null>(null);
  const summarisePollRef = useRef<number | null>(null);
  const navigate = useNavigate();

  const loadSidebar = useCallback(async () => {
    const [foldersRes, tagsRes, casesRes] = await Promise.all([
      api<{ folders: FolderEntry[] }>("/api/folders"),
      api<{ tags: { name: string; count: number }[] }>("/api/tags"),
      api<{ cases: Case[] }>("/api/cases"),
    ]);
    setFolders(foldersRes.folders);
    setTags(tagsRes.tags);
    setCases(casesRes.cases);
  }, []);

  const loadFiles = useCallback(async () => {
    const p = new URLSearchParams();
    if (activeFolders.length) p.set("folder", activeFolders[0]);
    if (types.length) p.set("file_type", types.join(","));
    if (statuses.length) p.set("status", statuses.join(","));
    if (activeTags.length) p.set("tag", activeTags[0]);
    if (activeCaseIds.length) p.set("case_id", String(activeCaseIds[0]));
    if (mode === "keyword" && q.trim()) p.set("q", q.trim());
    let rows = (await api<{ files: FileRow[] }>(`/api/files?${p}`)).files;
    if (activeFolders.length > 1) {
      rows = rows.filter((f) =>
        f.locations.some((l) =>
          activeFolders.some((af) =>
            `${l.root_folder}/${l.subfolder_path}`.replace(/\/$/, "").startsWith(af))));
    }
    if (activeTags.length > 1) {
      rows = rows.filter((f) => activeTags.some((t) => f.tags.includes(t)));
    }
    if (activeCaseIds.length > 1) {
      // multi-case filter: client-side — files must appear in any selected case
      const caseFileSets = await Promise.all(
        activeCaseIds.map((cid) =>
          api<{ files: FileRow[] }>(`/api/files?case_id=${cid}`).then((r) =>
            new Set(r.files.map((f) => f.id)))));
      rows = rows.filter((f) => caseFileSets.some((s) => s.has(f.id)));
    }
    setFiles(rows);
  }, [activeFolders, activeCaseIds, types, statuses, activeTags, q, mode]);

  useEffect(() => { loadSidebar().catch((e) => setError((e as Error).message)); }, [loadSidebar]);
  useEffect(() => { loadFiles().catch((e) => setError((e as Error).message)); }, [loadFiles]);

  async function runSemantic() {
    if (!q.trim()) { setSemantic(null); return; }
    setSearching(true); setError(""); setSemantic(null);
    try {
      const res = await api<{ results: SemanticResult[] }>(
        `/api/semantic-search?q=${encodeURIComponent(q.trim())}`);
      setSemantic(res.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  async function startScan() {
    setError("");
    navigate("/folder-upload");
  }

  async function runIndex() {
    setError("");
    await api("/api/index", { method: "POST" });
    indexPollRef.current = window.setInterval(async () => {
      const st = await api<IndexStatus>("/api/index/status");
      setIndexStatus(st);
      if (st.status === "done" && indexPollRef.current) {
        window.clearInterval(indexPollRef.current);
      }
    }, 700);
  }

  async function reveal(id: number) {
    try {
      const res = await api<{ ok: boolean; error?: string }>(
        `/api/files/${id}/reveal`, {
          method: "POST", body: JSON.stringify({ location_index: 0 }) });
      if (!res.ok && res.error) setError(res.error);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteFile(id: number) {
    try {
      await api("/api/files/" + id, { method: "DELETE" });
      setFiles((prev) => prev.filter((f) => f.id !== id));
    } finally {
      setConfirmDeleteId(null);
    }
  }

  async function generateSummaries() {
    setError("");
    try {
      const res = await api<{ status: string; total: number }>("/api/files/summarise-all", { method: "POST" });
      if (res.status === "nothing_to_do") { setError("All files already have summaries."); return; }
      summarisePollRef.current = window.setInterval(async () => {
        const prog = await api<{ running: boolean; done: number; total: number; errors: number }>("/api/files/summarise-all/status");
        setSummariseProgress(prog);
        if (!prog.running) {
          window.clearInterval(summarisePollRef.current!);
          summarisePollRef.current = null;
          loadFiles();
        }
      }, 1500);
    } catch (e) { setError((e as Error).message); }
  }

  async function clearAllFiles() {
    try {
      await api("/api/files", { method: "DELETE" });
      setFiles([]);
      setConfirmClearAll(false);
      loadSidebar();
    } catch (e) {
      setError((e as Error).message);
      setConfirmClearAll(false);
    }
  }

  async function toggleMdPreview(id: number) {
    if (expandedMd === id) { setExpandedMd(null); return; }
    setExpandedMd(id);
    if (!mdContent[id]) {
      try {
        const detail = await api<{ markdown: { content_md: string; keywords: string[]; summary: string | null } | null }>(`/api/files/${id}`);
        if (detail.markdown) {
          setMdContent((prev) => ({ ...prev, [id]: JSON.stringify(detail.markdown) }));
        }
      } catch { /* ignore */ }
    }
  }

  function toggleIn(list: string[], v: string, set: (x: string[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function toggleInNum(list: number[], v: number, set: (x: number[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function toggleSelect(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  const folderBubbles = folders.map((f) => ({
    full: `${f.root_folder}/${f.subfolder_path}`.replace(/\/$/, ""),
    label: f.subfolder_path || f.root_folder.split("/").filter(Boolean).pop() || f.root_folder,
    count: f.count,
  }));

  return (
    <div className="max-w-6xl mx-auto space-y-4 p-6">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={startScan}
          className="bg-amber-500 hover:bg-amber-400 text-black rounded-lg px-4 py-2 font-medium shadow-sm">
          + Add folder…
        </button>
        <button onClick={runIndex}
          className="border border-amber-500 text-amber-400 hover:bg-amber-500/10 rounded-lg px-4 py-2 font-medium">
          ⚡ Index for semantic search
        </button>

        {/* Generate summaries */}
        {summariseProgress?.running ? (
          <span className="text-sm text-zinc-400">
            Summarising {summariseProgress.done}/{summariseProgress.total}…
          </span>
        ) : (
          <button onClick={generateSummaries}
            className="border border-zinc-700 text-zinc-400 hover:text-amber-400 hover:border-amber-500/50 rounded-lg px-4 py-2 font-medium transition-colors text-sm">
            ✨ Generate summaries
          </button>
        )}
        {summariseProgress && !summariseProgress.running && summariseProgress.total > 0 && (
          <span className="text-xs text-zinc-500">
            {summariseProgress.done} summarised{summariseProgress.errors > 0 ? ` · ${summariseProgress.errors} errors` : ""}
          </span>
        )}

        {/* Clear all */}
        {confirmClearAll ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-zinc-400">Delete all {files.length} files?</span>
            <button onClick={clearAllFiles} className="text-red-400 hover:text-red-300 font-semibold">Yes, clear all</button>
            <button onClick={() => setConfirmClearAll(false)} className="text-zinc-500 hover:text-white">Cancel</button>
          </span>
        ) : (
          <button onClick={() => setConfirmClearAll(true)}
            className="border border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-800 rounded-lg px-4 py-2 font-medium transition-colors text-sm">
            Clear all docs
          </button>
        )}

        {scan && scan.status !== "done" && (
          <span className="text-sm text-zinc-500">Converting {scan.done}/{scan.total}…</span>
        )}
        {scan && scan.status === "done" && (
          <span className="text-sm text-zinc-500">
            Scan done: {scan.converted} converted · {scan.failed} failed
            {scan.skipped.length > 0 && ` · ${scan.skipped.length} skipped`}
          </span>
        )}
        {indexStatus && (
          <span className="text-sm text-zinc-500">
            {indexStatus.status === "running"
              ? `Indexing ${indexStatus.indexed}/${indexStatus.total}…`
              : `Indexed ${indexStatus.indexed} chunks${indexStatus.failed ? `, ${indexStatus.failed} failed` : ""}`}
          </span>
        )}
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
          {(["keyword", "semantic"] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m); setSemantic(null); }}
              className={`px-3 py-2 text-sm font-medium ${
                mode === m ? "bg-amber-500 text-black" : "bg-zinc-900 text-zinc-400"}`}>
              {m === "keyword" ? "🔎 Keyword" : "✨ Semantic"}
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && mode === "semantic" && runSemantic()}
          placeholder={mode === "keyword"
            ? 'Keyword search (e.g. indemnification, "force majeure")'
            : "Semantic search — describe what you're looking for, press Enter"}
          className="flex-1 border border-zinc-700 rounded-lg px-3 py-2 bg-zinc-900 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500" />
        {mode === "semantic" && (
          <button onClick={runSemantic} disabled={searching || !q.trim()}
            className="bg-amber-500 disabled:bg-zinc-700 text-black rounded-lg px-4 font-medium">
            {searching ? "Searching…" : "Search"}
          </button>
        )}
        <button disabled={selected.length === 0}
          onClick={() => navigate(`/chat?ids=${selected.join(",")}`)}
          className="bg-emerald-600 disabled:bg-zinc-700 text-white rounded-lg px-4 font-medium">
          💬 Chat ({selected.length})
        </button>
        <button disabled={selected.length === 0}
          onClick={() => navigate(`/review?ids=${selected.join(",")}`)}
          className="bg-violet-600 disabled:bg-zinc-700 text-white rounded-lg px-4 font-medium">
          ⚖️ New Case ({selected.length})
        </button>
      </div>

      {/* Filters */}
      <div className="space-y-2 bg-zinc-900 rounded-xl border border-zinc-800 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-zinc-500 w-14">FOLDERS</span>
          {folderBubbles.length === 0 && <span className="text-xs text-zinc-500">none yet</span>}
          {folderBubbles.map((f) => (
            <Bubble key={f.full} label={`📁 ${f.label}`} count={f.count}
              active={activeFolders.includes(f.full)}
              onClick={() => toggleIn(activeFolders, f.full, setActiveFolders)} />
          ))}
        </div>
        {cases.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-500 w-14">CASES</span>
            {cases.map((c) => (
              <Bubble key={c.id} label={`⚖️ ${c.name}`} count={c.file_count}
                active={activeCaseIds.includes(c.id)}
                onClick={() => toggleInNum(activeCaseIds, c.id, setActiveCaseIds)} />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-zinc-500 w-14">TYPE</span>
          {FILE_TYPES.map((t) => (
            <Bubble key={t} label={t} active={types.includes(t)}
              onClick={() => toggleIn(types, t, setTypes)} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-zinc-500 w-14">STATUS</span>
          {STATUSES.map((s) => (
            <Bubble key={s} label={s} active={statuses.includes(s)}
              onClick={() => toggleIn(statuses, s, setStatuses)} />
          ))}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-500 w-14">TAGS</span>
            {tags.map((t) => (
              <Bubble key={t.name} label={`#${t.name}`} count={t.count}
                active={activeTags.includes(t.name)}
                onClick={() => toggleIn(activeTags, t.name, setActiveTags)} />
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="text-red-400 bg-red-950/50 border border-red-800/50 rounded-lg px-3 py-2 text-sm">{error}</p>
      )}

      {/* Semantic results */}
      {mode === "semantic" && semantic !== null && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-500">Semantic results ({semantic.length})</h3>
          {semantic.length === 0 && <p className="text-zinc-400 text-sm">No relevant passages found.</p>}
          {semantic.map((r) => (
            <div key={r.file_id}
              className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 flex gap-4 items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link to={`/files/${r.file_id}`} className="font-medium text-amber-400 hover:underline">
                    {r.original_name}
                  </Link>
                  <span className="text-xs bg-amber-500/10 text-amber-400 rounded-full px-2 py-0.5">
                    {(r.score * 100).toFixed(0)}% match
                  </span>
                  <span className="text-xs text-zinc-500 uppercase">{r.file_type}</span>
                  <span className="text-xs bg-emerald-900/40 text-emerald-400 rounded-full px-2 py-0.5">from MD</span>
                </div>
                <p className="text-sm text-zinc-400 mt-1 font-mono text-xs leading-relaxed">…{r.snippet}…</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Link to={`/files/${r.file_id}`}
                  className="border border-zinc-700 text-zinc-300 rounded-lg px-3 py-1.5 text-sm hover:bg-zinc-800">Open MD</Link>
                <Link to={`/chat?ids=${r.file_id}`}
                  className="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm hover:bg-emerald-700">💬 Chat</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* File list */}
      {(mode === "keyword" || semantic === null) && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 divide-y divide-zinc-800/60">
          {files.length === 0 && (
            <p className="p-10 text-center text-zinc-500 text-sm">
              No files yet — click "Add folder…" to ingest documents.
            </p>
          )}
          {files.map((f) => {
            const typeStyle: Record<string, string> = {
              pdf:  "bg-red-900/50 text-red-400",
              docx: "bg-blue-900/50 text-blue-400",
              doc:  "bg-blue-900/50 text-blue-400",
              xlsx: "bg-green-900/50 text-green-400",
              csv:  "bg-green-900/50 text-green-400",
              msg:  "bg-purple-900/50 text-purple-400",
              eml:  "bg-purple-900/50 text-purple-400",
              txt:  "bg-zinc-700/60 text-zinc-300",
              rtf:  "bg-zinc-700/60 text-zinc-300",
            };
            const badge = typeStyle[f.file_type] ?? "bg-zinc-800 text-zinc-400";

            // Parse structured McKinsey summary
            let headline = "", bullets: string[] = [], bottomLine = "";
            let isStructured = false;
            if (f.summary) {
              for (const line of f.summary.split("\n")) {
                if (line.startsWith("HEADLINE:")) { headline = line.slice(9).trim(); isStructured = true; }
                else if (line.startsWith("•")) { bullets.push(line.slice(1).trim()); }
                else if (line.startsWith("BOTTOM LINE:")) { bottomLine = line.slice(12).trim(); }
              }
            }

            let mdParsed: { content_md: string; keywords: string[]; summary: string | null } | null = null;
            try { mdParsed = mdContent[f.id] ? JSON.parse(mdContent[f.id]) : null; } catch { /* */ }

            return (
              <div key={f.id} className="hover:bg-zinc-800/30 transition-colors px-4 py-3.5">
                {/* Top line: checkbox · type badge · filename · meta · actions */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <input type="checkbox" checked={selected.includes(f.id)}
                    onChange={() => toggleSelect(f.id)} className="shrink-0" />
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${badge}`}>
                    {f.file_type}
                  </span>
                  <Link to={`/files/${f.id}`}
                    className="text-amber-400 font-medium hover:underline truncate flex-1 min-w-0 text-sm">
                    {f.original_name}
                  </Link>
                  <span className={`hidden sm:inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusPill(f.status)}`}>
                    {f.status}
                  </span>
                  <span className="hidden md:inline text-xs text-zinc-500 shrink-0">{fmtSize(f.size_bytes)}</span>
                  {f.has_markdown && (
                    <button onClick={() => toggleMdPreview(f.id)} title="Preview markdown"
                      className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-mono transition-colors ${
                        expandedMd === f.id ? "bg-amber-500 text-black" : "bg-zinc-800 text-zinc-400 hover:bg-amber-500/20 hover:text-amber-400"}`}>
                      MD
                    </button>
                  )}
                  {/* Actions */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Link to={`/files/${f.id}`} title="View document"
                      className="p-1.5 rounded-md text-zinc-500 hover:text-amber-400 hover:bg-zinc-700 transition-colors">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                      </svg>
                    </Link>
                    <button onClick={() => reveal(f.id)} title="Reveal in Finder"
                      className="p-1.5 rounded-md text-zinc-500 hover:text-amber-400 hover:bg-zinc-700 transition-colors">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    </button>
                    <Link to={`/chat?ids=${f.id}`} title="Chat with this file"
                      className="p-1.5 rounded-md text-zinc-500 hover:text-amber-400 hover:bg-zinc-700 transition-colors">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </Link>
                    {confirmDeleteId === f.id ? (
                      <span className="flex items-center gap-1 text-xs ml-1">
                        <button onClick={() => deleteFile(f.id)}
                          className="text-red-400 hover:text-red-300 font-semibold px-1">Delete</button>
                        <button onClick={() => setConfirmDeleteId(null)}
                          className="text-zinc-500 hover:text-white px-1">Cancel</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(f.id)} title="Delete file"
                        className="p-1.5 rounded-md text-zinc-600 hover:text-red-400 hover:bg-red-950/30 transition-colors">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Path */}
                <p className="text-zinc-700 text-xs mt-0.5 ml-[3.75rem] truncate">
                  {f.locations.map((l) => l.subfolder_path || "/").join(", ")}
                </p>

                {/* Keywords */}
                {f.keywords?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2.5">
                    {f.keywords.map((kw) => (
                      <span key={kw} className="bg-blue-500/15 text-blue-400 text-xs rounded-full px-2 py-0.5 leading-none">
                        {kw}
                      </span>
                    ))}
                  </div>
                )}

                {/* Summary */}
                {f.summary && (
                  <div className="mt-3">
                    {isStructured ? (
                      <div className="text-xs space-y-2">
                        {headline && (
                          <p className="text-zinc-200 font-semibold leading-snug">{headline}</p>
                        )}
                        {bullets.length > 0 && (
                          <ul className="space-y-1.5 pl-0">
                            {bullets.map((b, i) => (
                              <li key={i} className="flex gap-2 text-zinc-400 leading-relaxed">
                                <span className="text-blue-500 shrink-0 mt-0.5 font-bold">·</span>
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {bottomLine && (
                          <p className="text-zinc-500 italic leading-relaxed border-l-2 border-zinc-700 pl-3 mt-1">
                            {bottomLine}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-zinc-500 text-xs leading-relaxed">{f.summary}</p>
                    )}
                  </div>
                )}

                {/* MD preview (expanded) */}
                {expandedMd === f.id && (
                  <div className="mt-4 pt-4 border-t border-zinc-800 space-y-4">
                    {!mdParsed ? (
                      <p className="text-xs text-zinc-600">Loading…</p>
                    ) : (
                      <>
                        {mdParsed.keywords?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">Keywords</p>
                            <div className="flex flex-wrap gap-1">
                              {mdParsed.keywords.map((kw) => (
                                <span key={kw} className="bg-blue-500/15 text-blue-400 text-xs rounded-full px-2 py-0.5">{kw}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {mdParsed.summary && (
                          <div>
                            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">Summary</p>
                            <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">{mdParsed.summary}</p>
                          </div>
                        )}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Markdown Content</p>
                            <span className="text-xs text-zinc-600">Used for semantic search</span>
                          </div>
                          <pre className="text-xs text-zinc-500 font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                            {mdParsed.content_md.slice(0, 2000)}{mdParsed.content_md.length > 2000 ? "\n\n[…]" : ""}
                          </pre>
                        </div>
                        <Link to={`/files/${f.id}`} className="inline-block text-xs text-amber-400 hover:underline">
                          Open full view →
                        </Link>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
