import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Case, FileRow, FolderEntry, IndexStatus, ScanProgress, SemanticResult } from "../api";
import Bubble from "../components/Bubble";

const FILE_TYPES = ["pdf", "docx", "doc", "msg", "eml", "xlsx", "csv", "txt", "rtf"];
const STATUSES = ["completed", "uploaded", "extracting", "chunking", "embedding", "failed"];

function fmtSize(n: number) {
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n > 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

const statusPill = (s: string) =>
  s === "completed" ? "bg-emerald-900/50 text-emerald-400" :
  s === "failed" ? "bg-red-900/50 text-red-400" :
  "bg-amber-900/50 text-amber-400";

export default function DocMgmt() {
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
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [summariseProgress, setSummariseProgress] = useState<{ running: boolean; done: number; total: number; errors: number } | null>(null);
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [expandedMd, setExpandedMd] = useState<number | null>(null);
  const [mdContent, setMdContent] = useState<Record<number, string>>({});
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("__none__");
  const [newCaseName, setNewCaseName] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const indexPollRef = useRef<number | null>(null);
  const summarisePollRef = useRef<number | null>(null);
  const scanPollRef = useRef<number | null>(null);
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
      const caseFileSets = await Promise.all(
        activeCaseIds.map((cid) =>
          api<{ files: FileRow[] }>(`/api/files?case_id=${cid}`).then((r) =>
            new Set(r.files.map((f) => f.id)))));
      rows = rows.filter((f) => caseFileSets.some((s) => s.has(f.id)));
    }
    setFiles(rows);
  }, [activeFolders, activeCaseIds, types, statuses, activeTags, q, mode]);

  useEffect(() => {
    loadSidebar().catch((e) => setError((e as Error).message));
  }, [loadSidebar]);

  useEffect(() => {
    loadFiles().catch((e) => setError((e as Error).message));
  }, [loadFiles]);

  useEffect(() => {
    return () => {
      if (indexPollRef.current) window.clearInterval(indexPollRef.current);
      if (summarisePollRef.current) window.clearInterval(summarisePollRef.current);
      if (scanPollRef.current) window.clearInterval(scanPollRef.current);
    };
  }, []);

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

  function openUploadModal() {
    api<{ cases: Case[] }>("/api/cases").then((r) => setCases(r.cases)).catch(() => {});
    setShowUploadModal(true);
  }

  function closeUploadModal() {
    if (uploading) return;
    setShowUploadModal(false);
    setPendingFiles([]);
    setSelectedCaseId("__none__");
    setNewCaseName("");
  }

  function startScanPoll(jobId: string) {
    if (scanPollRef.current) window.clearInterval(scanPollRef.current);
    scanPollRef.current = window.setInterval(async () => {
      try {
        const prog = await api<ScanProgress>(`/api/scan/${jobId}`);
        setScan(prog);
        if (prog.status === "done") {
          window.clearInterval(scanPollRef.current!);
          scanPollRef.current = null;
          setUploading(false);
          loadSidebar().catch(() => {});
          loadFiles().catch(() => {});
        }
      } catch {
        window.clearInterval(scanPollRef.current!);
        scanPollRef.current = null;
        setUploading(false);
        setError("Lost contact with server — please try again.");
      }
    }, 500);
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingFiles.length) return;
    setUploading(true);
    setError("");
    setScan(null);

    try {
      let caseId: number | null = null;

      if (selectedCaseId === "__new__" && newCaseName.trim()) {
        const c = await api<Case>("/api/cases", {
          method: "POST",
          body: JSON.stringify({ name: newCaseName.trim() }),
        });
        caseId = c.id;
      } else if (selectedCaseId && selectedCaseId !== "__none__") {
        caseId = parseInt(selectedCaseId, 10);
      }

      const formData = new FormData();
      pendingFiles.forEach((f) => formData.append("files", f));
      if (caseId !== null) formData.append("case_id", String(caseId));

      const { job_id } = await api<{ job_id: string }>("/api/upload", {
        method: "POST",
        headers: {},
        body: formData,
      });

      setShowUploadModal(false);
      setPendingFiles([]);
      setSelectedCaseId("__none__");
      setNewCaseName("");
      startScanPoll(job_id);
    } catch (err) {
      setError((err as Error).message);
      setUploading(false);
    }
  }

  function startScan() {
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
      await api(`/api/files/${id}`, { method: "DELETE" });
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
    <div className="msoit-page space-y-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <span className="msoit-kicker">Operational Review</span>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.03em] text-white">DocMgmt</h1>
          <p className="mt-3 text-sm leading-7 text-zinc-400">
            Keep uploads, folder intake, filtering, and processing actions in one place so the document queue stays easy to manage.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 xl:justify-end">
          <button
            onClick={openUploadModal}
            disabled={uploading}
            className="msoit-button msoit-button-primary min-w-[11rem] disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            {uploading ? "Uploading..." : "Add files"}
          </button>
          <button
            onClick={startScan}
            className="msoit-button msoit-button-secondary min-w-[11rem]"
          >
            Add folder
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="msoit-stat px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Documents</p>
          <p className="mt-2 text-3xl font-semibold text-white">{files.length}</p>
        </div>
        <div className="msoit-stat px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Selected</p>
          <p className="mt-2 text-3xl font-semibold text-white">{selected.length}</p>
        </div>
        <div className="msoit-stat px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Index</p>
          <p className="mt-2 text-sm text-zinc-300">
            {indexStatus
              ? indexStatus.status === "running"
                ? `Indexing ${indexStatus.indexed}/${indexStatus.total}...`
                : `${indexStatus.indexed} chunks indexed`
              : "Ready"}
          </p>
        </div>
      </div>

      <div className="msoit-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={runIndex} className="msoit-button msoit-button-secondary text-sm">
            Index for semantic search
          </button>

          {summariseProgress?.running ? (
            <span className="text-sm text-zinc-400">
              Summarising {summariseProgress.done}/{summariseProgress.total}...
            </span>
          ) : (
            <button
              onClick={generateSummaries}
              className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-400"
            >
              Generate summaries
            </button>
          )}

          {summariseProgress && !summariseProgress.running && summariseProgress.total > 0 && (
            <span className="text-xs text-zinc-500">
              {summariseProgress.done} summarised{summariseProgress.errors > 0 ? ` · ${summariseProgress.errors} errors` : ""}
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <button
              disabled={selected.length === 0}
              onClick={() => navigate(`/chat?ids=${selected.join(",")}`)}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-700"
            >
              Chat ({selected.length})
            </button>
            <button
              disabled={selected.length === 0}
              onClick={() => navigate(`/review?ids=${selected.join(",")}`)}
              className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-700"
            >
              New Case ({selected.length})
            </button>
            {confirmClearAll ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-zinc-400">Delete all {files.length} files?</span>
                <button onClick={clearAllFiles} className="font-semibold text-red-400 hover:text-red-300">Yes, clear all</button>
                <button onClick={() => setConfirmClearAll(false)} className="text-zinc-500 hover:text-white">Cancel</button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmClearAll(true)}
                className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-500 transition-colors hover:border-red-800 hover:text-red-400"
              >
                Clear all docs
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="msoit-panel p-4 sm:p-5">
        <div className="flex gap-2">
          <div className="flex overflow-hidden rounded-full border border-zinc-700">
            {(["keyword", "semantic"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setSemantic(null); }}
                className={`px-4 py-2 text-sm font-medium ${
                  mode === m ? "bg-amber-500 text-black" : "bg-zinc-900 text-zinc-400"
                }`}
              >
                {m === "keyword" ? "Keyword" : "Semantic"}
              </button>
            ))}
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && mode === "semantic" && runSemantic()}
            placeholder={mode === "keyword"
              ? 'Keyword search (e.g. indemnification, "force majeure")'
              : "Semantic search — describe what you're looking for"}
            className="msoit-input flex-1"
          />
          {mode === "semantic" && (
            <button onClick={runSemantic} disabled={searching || !q.trim()} className="msoit-button msoit-button-primary disabled:bg-zinc-700 disabled:text-zinc-500">
              {searching ? "Searching..." : "Search"}
            </button>
          )}
        </div>

        <div className="mt-5 space-y-3 border-t border-white/8 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Folders</span>
            {folderBubbles.length === 0 && <span className="text-xs text-zinc-500">none yet</span>}
            {folderBubbles.map((f) => (
              <Bubble key={f.full} label={`📁 ${f.label}`} count={f.count} active={activeFolders.includes(f.full)} onClick={() => toggleIn(activeFolders, f.full, setActiveFolders)} />
            ))}
          </div>
          {cases.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Cases</span>
              {cases.map((c) => (
                <Bubble key={c.id} label={`⚖️ ${c.name}`} count={c.file_count} active={activeCaseIds.includes(c.id)} onClick={() => toggleInNum(activeCaseIds, c.id, setActiveCaseIds)} />
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Type</span>
            {FILE_TYPES.map((t) => (
              <Bubble key={t} label={t} active={types.includes(t)} onClick={() => toggleIn(types, t, setTypes)} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Status</span>
            {STATUSES.map((s) => (
              <Bubble key={s} label={s} active={statuses.includes(s)} onClick={() => toggleIn(statuses, s, setStatuses)} />
            ))}
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Tags</span>
              {tags.map((t) => (
                <Bubble key={t.name} label={`#${t.name}`} count={t.count} active={activeTags.includes(t.name)} onClick={() => toggleIn(activeTags, t.name, setActiveTags)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {(scan || error) && (
        <div className="rounded-xl border border-white/8 bg-zinc-950/70 px-4 py-3 text-sm">
          {error && <p className="text-red-400">{error}</p>}
          {scan && scan.status !== "done" && (
            <p className="text-zinc-400">Converting {scan.done}/{scan.total}...</p>
          )}
          {scan && scan.status === "done" && (
            <p className="text-emerald-400">Done: {scan.converted} converted · {scan.failed} failed</p>
          )}
        </div>
      )}

      {error && !scan && (
        <p className="rounded-lg border border-red-800/50 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {mode === "semantic" && semantic !== null && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-500">Semantic results ({semantic.length})</h3>
          {semantic.length === 0 && <p className="text-sm text-zinc-400">No relevant passages found.</p>}
          {semantic.map((r) => (
            <div key={r.file_id} className="msoit-panel flex items-start gap-4 p-4">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/files/${r.file_id}`} className="font-medium text-amber-400 hover:underline">
                    {r.original_name}
                  </Link>
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                    {(r.score * 100).toFixed(0)}% match
                  </span>
                  <span className="text-xs uppercase text-zinc-500">{r.file_type}</span>
                </div>
                <p className="mt-1 font-mono text-xs leading-relaxed text-zinc-400">...{r.snippet}...</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link to={`/files/${r.file_id}`} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">Open</Link>
                <Link to={`/chat?ids=${r.file_id}`} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700">Chat</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {(mode === "keyword" || semantic === null) && (
        <div className="msoit-panel divide-y divide-white/8 overflow-hidden">
          {files.length === 0 && (
            <p className="p-10 text-center text-sm text-zinc-500">
              No files yet — use Add files or Add folder to bring documents in.
            </p>
          )}
          {files.map((f) => {
            const typeStyle: Record<string, string> = {
              pdf: "bg-red-900/50 text-red-400",
              docx: "bg-blue-900/50 text-blue-400",
              doc: "bg-blue-900/50 text-blue-400",
              xlsx: "bg-green-900/50 text-green-400",
              csv: "bg-green-900/50 text-green-400",
              msg: "bg-purple-900/50 text-purple-400",
              eml: "bg-purple-900/50 text-purple-400",
              txt: "bg-zinc-700/60 text-zinc-300",
              rtf: "bg-zinc-700/60 text-zinc-300",
            };
            const badge = typeStyle[f.file_type] ?? "bg-zinc-800 text-zinc-400";

            let headline = "";
            let bullets: string[] = [];
            let bottomLine = "";
            let isStructured = false;
            if (f.summary) {
              for (const line of f.summary.split("\n")) {
                if (line.startsWith("HEADLINE:")) { headline = line.slice(9).trim(); isStructured = true; }
                else if (line.startsWith("•")) { bullets.push(line.slice(1).trim()); }
                else if (line.startsWith("BOTTOM LINE:")) { bottomLine = line.slice(12).trim(); }
              }
            }

            let mdParsed: { content_md: string; keywords: string[]; summary: string | null } | null = null;
            try { mdParsed = mdContent[f.id] ? JSON.parse(mdContent[f.id]) : null; } catch { /* ignore */ }

            return (
              <div key={f.id} className="px-4 py-3.5 transition-colors hover:bg-zinc-800/20">
                <div className="flex min-w-0 items-center gap-2.5">
                  <input type="checkbox" checked={selected.includes(f.id)} onChange={() => toggleSelect(f.id)} className="shrink-0" />
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${badge}`}>
                    {f.file_type}
                  </span>
                  <Link to={`/files/${f.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-amber-400 hover:underline">
                    {f.original_name}
                  </Link>
                  <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-medium sm:inline-flex ${statusPill(f.status)}`}>
                    {f.status}
                  </span>
                  <span className="hidden shrink-0 text-xs text-zinc-500 md:inline">{fmtSize(f.size_bytes)}</span>
                  {f.has_markdown && (
                    <button
                      onClick={() => toggleMdPreview(f.id)}
                      title="Preview markdown"
                      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-xs transition-colors ${
                        expandedMd === f.id ? "bg-amber-500 text-black" : "bg-zinc-800 text-zinc-400 hover:bg-amber-500/20 hover:text-amber-400"
                      }`}
                    >
                      MD
                    </button>
                  )}
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Link to={`/files/${f.id}`} title="View document" className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-amber-400">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                      </svg>
                    </Link>
                    <button onClick={() => reveal(f.id)} title="Reveal in Finder" className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-amber-400">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    </button>
                    <Link to={`/chat?ids=${f.id}`} title="Chat with this file" className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-amber-400">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </Link>
                    {confirmDeleteId === f.id ? (
                      <span className="ml-1 flex items-center gap-1 text-xs">
                        <button onClick={() => deleteFile(f.id)} className="px-1 font-semibold text-red-400 hover:text-red-300">Delete</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="px-1 text-zinc-500 hover:text-white">Cancel</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(f.id)} title="Delete file" className="rounded-md p-1.5 text-zinc-600 transition-colors hover:bg-red-950/30 hover:text-red-400">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                <p className="ml-[3.75rem] mt-0.5 truncate text-xs text-zinc-700">
                  {f.locations.map((l) => l.subfolder_path || "/").join(", ")}
                </p>

                {f.keywords?.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {f.keywords.map((kw) => (
                      <span key={kw} className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs leading-none text-blue-400">
                        {kw}
                      </span>
                    ))}
                  </div>
                )}

                {f.summary && (
                  <div className="mt-3">
                    {isStructured ? (
                      <div className="space-y-2 text-xs">
                        {headline && <p className="font-semibold leading-snug text-zinc-200">{headline}</p>}
                        {bullets.length > 0 && (
                          <ul className="space-y-1.5 pl-0">
                            {bullets.map((b, i) => (
                              <li key={i} className="flex gap-2 leading-relaxed text-zinc-400">
                                <span className="mt-0.5 shrink-0 font-bold text-blue-500">·</span>
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {bottomLine && <p className="leading-relaxed text-zinc-400"><span className="font-semibold text-zinc-200">Bottom line:</span> {bottomLine}</p>}
                      </div>
                    ) : (
                      <p className="text-xs leading-relaxed text-zinc-400">{f.summary}</p>
                    )}
                  </div>
                )}

                {expandedMd === f.id && mdParsed && (
                  <div className="msoit-panel-quiet mt-3 space-y-2 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Extracted text preview</p>
                    {mdParsed.summary && <p className="text-xs leading-relaxed text-zinc-300">{mdParsed.summary}</p>}
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
                      {mdParsed.content_md.slice(0, 2400)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="msoit-panel w-full max-w-md p-6 sm:p-8">
            <span className="msoit-kicker">New intake</span>
            <h2 className="mt-5 text-2xl font-semibold text-white">Add files</h2>
            <p className="mt-2 text-sm text-zinc-400">Optionally assign incoming material to an existing case.</p>

            <form onSubmit={handleUpload} className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">Files *</label>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.doc,.msg,.eml,.xlsx,.csv,.txt,.rtf"
                  required
                  onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []))}
                  className="w-full text-sm text-zinc-300 file:mr-4 file:cursor-pointer file:rounded-full file:border file:border-white/10 file:bg-white/[0.04] file:px-4 file:py-2 file:text-zinc-200 file:transition-colors file:hover:bg-white/[0.08]"
                />
                {pendingFiles.length > 0 && (
                  <p className="mt-1 text-xs text-zinc-500">
                    {pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""} selected
                  </p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">Case (optional)</label>
                <select value={selectedCaseId} onChange={(e) => setSelectedCaseId(e.target.value)} className="msoit-select text-sm">
                  <option value="__none__">— No case —</option>
                  {cases.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                  <option value="__new__">+ New case…</option>
                </select>
              </div>

              {selectedCaseId === "__new__" && (
                <div>
                  <input
                    autoFocus
                    placeholder="Case name *"
                    value={newCaseName}
                    onChange={(e) => setNewCaseName(e.target.value)}
                    required
                    className="msoit-input text-sm"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={uploading || pendingFiles.length === 0} className="msoit-button msoit-button-primary flex-1 disabled:bg-zinc-700 disabled:text-zinc-500">
                  {uploading ? "Uploading..." : "Upload"}
                </button>
                <button type="button" onClick={closeUploadModal} className="px-4 py-2.5 text-sm text-zinc-400 hover:text-white">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
