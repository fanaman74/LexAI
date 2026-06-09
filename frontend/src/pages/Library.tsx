import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { FileRow, FolderEntry, ScanProgress } from "../api";

const FILE_TYPES = ["pdf", "docx", "doc", "msg", "eml", "xlsx", "csv", "txt", "rtf"];
const STATUSES = ["converted", "pending", "failed", "needs_ocr"];

function fmtSize(n: number) {
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n > 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

export default function Library() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);
  const [folder, setFolder] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [error, setError] = useState("");
  const pollRef = useRef<number | null>(null);
  const navigate = useNavigate();

  const loadSidebar = useCallback(async () => {
    setFolders((await api<{ folders: FolderEntry[] }>("/api/folders")).folders);
    setTags((await api<{ tags: { name: string; count: number }[] }>("/api/tags")).tags);
  }, []);

  const loadFiles = useCallback(async () => {
    const p = new URLSearchParams();
    if (folder) p.set("folder", folder);
    if (types.length) p.set("file_type", types.join(","));
    if (statuses.length) p.set("status", statuses.join(","));
    if (tag) p.set("tag", tag);
    if (q.trim()) p.set("q", q.trim());
    setFiles((await api<{ files: FileRow[] }>(`/api/files?${p}`)).files);
  }, [folder, types, statuses, tag, q]);

  useEffect(() => {
    loadSidebar().catch((e) => setError((e as Error).message));
  }, [loadSidebar]);
  useEffect(() => {
    loadFiles().catch((e) => setError((e as Error).message));
  }, [loadFiles]);

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

  function toggle(list: string[], v: string, set: (x: string[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function toggleSelect(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <div className="flex gap-6">
      <aside className="w-72 shrink-0 space-y-6">
        <button onClick={startScan}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-md py-2 font-medium">
          + Add folder…
        </button>
        {scan && scan.status !== "done" && (
          <div className="bg-white rounded-md p-3 shadow text-sm">
            <p>Converting {scan.done}/{scan.total}…</p>
            <div className="h-2 bg-slate-200 rounded mt-2">
              <div className="h-2 bg-blue-500 rounded"
                style={{ width: `${scan.total ? (100 * scan.done) / scan.total : 0}%` }} />
            </div>
          </div>
        )}
        {scan && scan.status === "done" && (
          <div className="bg-white rounded-md p-3 shadow text-sm">
            <p className="font-medium">Scan finished</p>
            <p>{scan.converted} converted · {scan.failed} failed · {scan.ocr} OCR'd</p>
            {scan.skipped.length > 0 && (
              <p className="text-slate-500 mt-1">{scan.skipped.length} unsupported skipped</p>
            )}
            {scan.error && <p className="text-red-600 mt-1">{scan.error}</p>}
          </div>
        )}

        <section className="bg-white rounded-md p-3 shadow">
          <h3 className="font-semibold text-sm mb-2">Folders</h3>
          <button onClick={() => setFolder("")}
            className={`block text-sm mb-1 ${!folder ? "font-bold" : ""}`}>All folders</button>
          {folders.map((f) => {
            const full = `${f.root_folder}/${f.subfolder_path}`.replace(/\/$/, "");
            const depth = f.subfolder_path ? f.subfolder_path.split("/").length : 0;
            return (
              <button key={full} onClick={() => setFolder(full)}
                style={{ paddingLeft: depth * 12 }}
                className={`block text-sm truncate w-full text-left mb-1 ${
                  folder === full ? "font-bold text-blue-700" : "text-slate-700"}`}>
                📁 {f.subfolder_path || f.root_folder} ({f.count})
              </button>
            );
          })}
        </section>

        <section className="bg-white rounded-md p-3 shadow">
          <h3 className="font-semibold text-sm mb-2">Type</h3>
          {FILE_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={types.includes(t)}
                onChange={() => toggle(types, t, setTypes)} /> {t}
            </label>
          ))}
        </section>

        <section className="bg-white rounded-md p-3 shadow">
          <h3 className="font-semibold text-sm mb-2">Status</h3>
          {STATUSES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={statuses.includes(s)}
                onChange={() => toggle(statuses, s, setStatuses)} /> {s}
            </label>
          ))}
        </section>

        <section className="bg-white rounded-md p-3 shadow">
          <h3 className="font-semibold text-sm mb-2">Tags</h3>
          <button onClick={() => setTag("")}
            className={`block text-sm mb-1 ${!tag ? "font-bold" : ""}`}>All tags</button>
          {tags.map((t) => (
            <button key={t.name} onClick={() => setTag(t.name)}
              className={`block text-sm mb-1 ${tag === t.name ? "font-bold text-blue-700" : ""}`}>
              #{t.name} ({t.count})
            </button>
          ))}
        </section>
      </aside>

      <section className="flex-1">
        <div className="flex gap-3 mb-4">
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder='Full-text search (e.g. indemnification, "force majeure")'
            className="flex-1 border border-slate-300 rounded-md px-3 py-2 bg-white" />
          <button disabled={selected.length === 0}
            onClick={() => navigate(`/analyze?ids=${selected.join(",")}`)}
            className="bg-emerald-600 disabled:bg-slate-300 text-white rounded-md px-4 font-medium">
            Analyze ({selected.length})
          </button>
        </div>
        {error && <p className="text-red-600 mb-2">{error}</p>}
        <table className="w-full bg-white rounded-md shadow text-sm">
          <thead>
            <tr className="text-left border-b text-slate-500">
              <th className="p-2 w-8"></th>
              <th className="p-2">Name</th>
              <th className="p-2">Folder</th>
              <th className="p-2">Type</th>
              <th className="p-2">Size</th>
              <th className="p-2">Status</th>
              <th className="p-2">Tags</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className="border-b hover:bg-slate-50">
                <td className="p-2">
                  <input type="checkbox" checked={selected.includes(f.id)}
                    onChange={() => toggleSelect(f.id)} />
                </td>
                <td className="p-2">
                  <Link to={`/files/${f.id}`} className="text-blue-700 hover:underline">
                    {f.original_name}
                  </Link>
                </td>
                <td className="p-2 text-slate-500 truncate max-w-48">
                  {f.locations.map((l) => l.subfolder_path || "/").join(", ")}
                </td>
                <td className="p-2">{f.file_type}</td>
                <td className="p-2">{fmtSize(f.size_bytes)}</td>
                <td className="p-2">
                  <span className={
                    f.status === "converted" ? "text-emerald-700" :
                    f.status === "failed" ? "text-red-600" : "text-amber-600"}>
                    {f.status}
                  </span>
                </td>
                <td className="p-2">{f.tags.map((t) => `#${t}`).join(" ")}</td>
              </tr>
            ))}
            {files.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-slate-400">
                No files yet — click "Add folder…" to ingest documents.
              </td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
