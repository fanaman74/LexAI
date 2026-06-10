import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { FileRow, FolderEntry, IndexStatus, ScanProgress, SemanticResult } from "../api";
import Bubble from "../components/Bubble";

const FILE_TYPES = ["pdf", "docx", "doc", "msg", "eml", "xlsx", "csv", "txt", "rtf"];
const STATUSES = ["converted", "pending", "failed", "needs_ocr"];

function fmtSize(n: number) {
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n > 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

const statusPill = (s: string) =>
  s === "converted" ? "bg-emerald-100 text-emerald-700" :
  s === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";

export default function Library() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);
  const [activeFolders, setActiveFolders] = useState<string[]>([]);
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
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const indexPollRef = useRef<number | null>(null);
  const navigate = useNavigate();

  const loadSidebar = useCallback(async () => {
    setFolders((await api<{ folders: FolderEntry[] }>("/api/folders")).folders);
    setTags((await api<{ tags: { name: string; count: number }[] }>("/api/tags")).tags);
  }, []);

  const loadFiles = useCallback(async () => {
    const p = new URLSearchParams();
    if (activeFolders.length) p.set("folder", activeFolders[0]);
    if (types.length) p.set("file_type", types.join(","));
    if (statuses.length) p.set("status", statuses.join(","));
    if (activeTags.length) p.set("tag", activeTags[0]);
    if (mode === "keyword" && q.trim()) p.set("q", q.trim());
    let rows = (await api<{ files: FileRow[] }>(`/api/files?${p}`)).files;
    // additional folders/tags beyond the first are filtered client-side (OR semantics)
    if (activeFolders.length > 1) {
      rows = rows.filter((f) =>
        f.locations.some((l) =>
          activeFolders.some((af) =>
            `${l.root_folder}/${l.subfolder_path}`.replace(/\/$/, "").startsWith(af))));
    }
    if (activeTags.length > 1) {
      rows = rows.filter((f) => activeTags.some((t) => f.tags.includes(t)));
    }
    setFiles(rows);
  }, [activeFolders, types, statuses, activeTags, q, mode]);

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
    try {
      const picked = await api<{ path: string | null }>("/api/pick-folder", { method: "POST" });
      if (!picked.path) return;
      const { job_id } = await api<{ job_id: string }>("/api/scan", {
        method: "POST", body: JSON.stringify({ path: picked.path }),
      });
      pollRef.current = window.setInterval(async () => {
        const prog = await api<ScanProgress>(`/api/scan/${job_id}`);
        setScan(prog);
        if (prog.status === "done") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          loadSidebar();
          loadFiles();
        }
      }, 500);
    } catch (e) {
      setError((e as Error).message);
    }
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

  function toggleIn(list: string[], v: string, set: (x: string[]) => void) {
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
      <div className="flex items-center gap-3">
        <button onClick={startScan}
          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 font-medium shadow-sm">
          + Add folder…
        </button>
        <button onClick={runIndex}
          className="border border-indigo-300 text-indigo-700 hover:bg-indigo-50 rounded-lg px-4 py-2 font-medium">
          ⚡ Index for semantic search
        </button>
        {scan && scan.status !== "done" && (
          <span className="text-sm text-slate-500">
            Converting {scan.done}/{scan.total}…
          </span>
        )}
        {scan && scan.status === "done" && (
          <span className="text-sm text-slate-500">
            Scan done: {scan.converted} converted · {scan.failed} failed
            {scan.skipped.length > 0 && ` · ${scan.skipped.length} skipped`}
          </span>
        )}
        {indexStatus && (
          <span className="text-sm text-slate-500">
            {indexStatus.status === "running"
              ? `Indexing ${indexStatus.indexed}/${indexStatus.total}…`
              : `Indexed ${indexStatus.indexed} chunks${indexStatus.failed ? `, ${indexStatus.failed} failed` : ""}`}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <div className="flex rounded-lg border border-slate-300 overflow-hidden">
          {(["keyword", "semantic"] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m); setSemantic(null); }}
              className={`px-3 py-2 text-sm font-medium ${
                mode === m ? "bg-indigo-600 text-white" : "bg-white text-slate-600"}`}>
              {m === "keyword" ? "🔎 Keyword" : "✨ Semantic"}
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && mode === "semantic" && runSemantic()}
          placeholder={mode === "keyword"
            ? 'Keyword search (e.g. indemnification, "force majeure")'
            : "Semantic search — describe what you're looking for, press Enter"}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 bg-white" />
        {mode === "semantic" && (
          <button onClick={runSemantic} disabled={searching || !q.trim()}
            className="bg-indigo-600 disabled:bg-slate-300 text-white rounded-lg px-4 font-medium">
            {searching ? "Searching…" : "Search"}
          </button>
        )}
        <button disabled={selected.length === 0}
          onClick={() => navigate(`/chat?ids=${selected.join(",")}`)}
          className="bg-emerald-600 disabled:bg-slate-300 text-white rounded-lg px-4 font-medium">
          💬 Chat ({selected.length})
        </button>
        <button disabled={selected.length === 0}
          onClick={() => navigate(`/review?ids=${selected.join(",")}`)}
          className="bg-violet-600 disabled:bg-slate-300 text-white rounded-lg px-4 font-medium">
          ⚖️ New Case ({selected.length})
        </button>
      </div>

      <div className="space-y-2 bg-white rounded-xl shadow-sm border border-slate-200 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-400 w-14">FOLDERS</span>
          {folderBubbles.length === 0 && <span className="text-xs text-slate-400">none yet</span>}
          {folderBubbles.map((f) => (
            <Bubble key={f.full} label={`📁 ${f.label}`} count={f.count}
              active={activeFolders.includes(f.full)}
              onClick={() => toggleIn(activeFolders, f.full, setActiveFolders)} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-400 w-14">TYPE</span>
          {FILE_TYPES.map((t) => (
            <Bubble key={t} label={t} active={types.includes(t)}
              onClick={() => toggleIn(types, t, setTypes)} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-400 w-14">STATUS</span>
          {STATUSES.map((s) => (
            <Bubble key={s} label={s} active={statuses.includes(s)}
              onClick={() => toggleIn(statuses, s, setStatuses)} />
          ))}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-400 w-14">TAGS</span>
            {tags.map((t) => (
              <Bubble key={t.name} label={`#${t.name}`} count={t.count}
                active={activeTags.includes(t.name)}
                onClick={() => toggleIn(activeTags, t.name, setActiveTags)} />
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {mode === "semantic" && semantic !== null && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-500">
            Semantic results ({semantic.length})
          </h3>
          {semantic.length === 0 && (
            <p className="text-slate-400 text-sm">No relevant passages found.</p>
          )}
          {semantic.map((r) => (
            <div key={r.file_id}
              className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex gap-4 items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Link to={`/files/${r.file_id}`}
                    className="font-medium text-indigo-700 hover:underline">
                    {r.original_name}
                  </Link>
                  <span className="text-xs bg-indigo-50 text-indigo-600 rounded-full px-2 py-0.5">
                    {(r.score * 100).toFixed(0)}% match
                  </span>
                  <span className="text-xs text-slate-400 uppercase">{r.file_type}</span>
                </div>
                <p className="text-sm text-slate-600 mt-1">…{r.snippet}…</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Link to={`/files/${r.file_id}`}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50">
                  Open
                </Link>
                <Link to={`/chat?ids=${r.file_id}`}
                  className="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm hover:bg-emerald-700">
                  💬 Chat
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {(mode === "keyword" || semantic === null) && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="p-3 w-8"></th>
                <th className="p-3">Name</th>
                <th className="p-3">Folder</th>
                <th className="p-3">Type</th>
                <th className="p-3">Size</th>
                <th className="p-3">Status</th>
                <th className="p-3">Tags</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-b border-slate-100 hover:bg-indigo-50/40">
                  <td className="p-3">
                    <input type="checkbox" checked={selected.includes(f.id)}
                      onChange={() => toggleSelect(f.id)} />
                  </td>
                  <td className="p-3">
                    <Link to={`/files/${f.id}`}
                      className="text-indigo-700 font-medium hover:underline">
                      {f.original_name}
                    </Link>
                  </td>
                  <td className="p-3 text-slate-500 truncate max-w-40">
                    {f.locations.map((l) => l.subfolder_path || "/").join(", ")}
                  </td>
                  <td className="p-3 uppercase text-xs text-slate-500">{f.file_type}</td>
                  <td className="p-3 text-slate-500">{fmtSize(f.size_bytes)}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusPill(f.status)}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className="p-3 text-slate-500">{f.tags.map((t) => `#${t}`).join(" ")}</td>
                  <td className="p-3">
                    <div className="flex gap-1 justify-end">
                      <Link to={`/files/${f.id}`} title="View Markdown"
                        className="border border-slate-300 rounded-md px-2 py-1 text-xs hover:bg-slate-100">
                        MD
                      </Link>
                      <a href={`/api/files/${f.id}/original?inline=1`} target="_blank"
                        rel="noreferrer" title="View original"
                        className="border border-slate-300 rounded-md px-2 py-1 text-xs hover:bg-slate-100">
                        Original
                      </a>
                      <button onClick={() => reveal(f.id)} title="Reveal in Finder"
                        className="border border-slate-300 rounded-md px-2 py-1 text-xs hover:bg-slate-100">
                        📂
                      </button>
                      <Link to={`/chat?ids=${f.id}`} title="Chat with this file"
                        className="border border-emerald-300 text-emerald-700 rounded-md px-2 py-1 text-xs hover:bg-emerald-50">
                        💬
                      </Link>
                      {confirmDeleteId === f.id ? (
                        <span className="flex items-center gap-1 text-xs ml-1">
                          <button
                            onClick={() => deleteFile(f.id)}
                            className="text-red-400 hover:text-red-300 font-medium"
                          >
                            Remove
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-slate-500 hover:text-white"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(f.id)}
                          className="text-slate-500 hover:text-red-400 transition-colors"
                          title="Remove from index"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {files.length === 0 && (
                <tr><td colSpan={8} className="p-10 text-center text-slate-400">
                  No files yet — click "Add folder…" to ingest documents.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
