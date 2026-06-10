import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { IndexStatus, ScanProgress } from "../api";

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<{ total: number; indexed: number; failed: number } | null>(null);
  const pollRef = useRef<number | null>(null);

  const refreshStats = useCallback(() => {
    Promise.all([
      api<{ files: { status: string }[] }>("/api/files"),
      api<IndexStatus>("/api/index/status"),
    ])
      .then(([filesRes, indexRes]) => {
        setStats({
          total: filesRes.files.length,
          indexed: indexRes.indexed,
          failed: filesRes.files.filter((f) => f.status === "failed").length,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStats();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [refreshStats]);

  function startPoll(job_id: string, onDone?: () => void) {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const prog = await api<ScanProgress>(`/api/scan/${job_id}`);
        setScan(prog);
        if (prog.status === "done") {
          window.clearInterval(pollRef.current!);
          pollRef.current = null;
          refreshStats();
          onDone?.();
        }
      } catch {
        window.clearInterval(pollRef.current!);
        pollRef.current = null;
        setUploading(false);
        setError("Lost contact with server — please try again.");
      }
    }, 500);
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploading(true);
    setError("");
    setScan(null);
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append("files", f));
      const { job_id } = await api<{ job_id: string }>("/api/upload", {
        method: "POST",
        headers: {},
        body: formData,
      });
      startPoll(job_id, () => setUploading(false));
    } catch (err) {
      setError((err as Error).message);
      setUploading(false);
    }
  }

  async function startScan() {
    setError("");
    setScan(null);
    try {
      const picked = await api<{ path: string | null }>("/api/pick-folder", { method: "POST" });
      if (!picked.path) return;
      const { job_id } = await api<{ job_id: string }>("/api/scan", {
        method: "POST",
        body: JSON.stringify({ path: picked.path }),
      });
      startPoll(job_id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 flex flex-col items-center justify-center relative overflow-hidden">
      {/* background glow orb */}
      <div className="absolute w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-3xl animate-pulse pointer-events-none" />

      <div className="relative z-10 text-center px-6 max-w-2xl w-full">
        <h1
          className="text-5xl font-bold text-white mb-4 opacity-0"
          style={{ animation: "fadeSlideUp 0.6s ease-out 0.1s forwards" }}
        >
          Your Legal Documents,{" "}
          <span className="text-indigo-400">Intelligently Organized</span>
        </h1>

        <p
          className="text-slate-300 text-xl mb-10 opacity-0"
          style={{ animation: "fadeSlideUp 0.6s ease-out 0.3s forwards" }}
        >
          Ingest, search, and analyze case files with AI — entirely on your machine.
        </p>

        <div
          className="flex gap-4 justify-center flex-wrap opacity-0"
          style={{ animation: "fadeSlideUp 0.6s ease-out 0.5s forwards" }}
        >
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-600 text-white rounded-xl px-8 py-3.5 font-semibold text-lg shadow-lg transition-colors"
          >
            {uploading ? "Uploading…" : "Upload Files"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.msg,.eml,.xlsx,.csv,.txt,.rtf"
            className="hidden"
            onChange={handleFiles}
          />
          <button
            onClick={startScan}
            className="border border-indigo-400 text-indigo-300 hover:bg-indigo-900/40 rounded-xl px-8 py-3.5 font-semibold text-lg transition-colors"
          >
            Add Folder
          </button>
        </div>

        {(scan || error) && (
          <div
            className="mt-6 text-sm opacity-0"
            style={{ animation: "fadeSlideUp 0.4s ease-out 0.1s forwards" }}
          >
            {error && <p className="text-red-400">{error}</p>}
            {scan && scan.status !== "done" && (
              <p className="text-slate-300">Converting {scan.done}/{scan.total}…</p>
            )}
            {scan && scan.status === "done" && (
              <p className="text-emerald-400">
                Done: {scan.converted} converted · {scan.failed} failed
              </p>
            )}
          </div>
        )}

        <div
          className="mt-8 opacity-0"
          style={{ animation: "fadeSlideUp 0.6s ease-out 0.7s forwards" }}
        >
          <Link
            to="/library"
            className="text-slate-400 hover:text-white text-sm transition-colors"
          >
            Browse Library →
          </Link>
        </div>
      </div>

      {stats && (
        <div
          className="absolute bottom-12 flex gap-6 opacity-0"
          style={{ animation: "fadeSlideUp 0.6s ease-out 0.9s forwards" }}
        >
          {[
            { label: "Documents", value: stats.total },
            { label: "Indexed Chunks", value: stats.indexed },
            { label: "Failed", value: stats.failed },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white/5 backdrop-blur border border-white/10 rounded-xl px-8 py-4 text-center"
            >
              <p className="text-3xl font-bold text-white">{s.value}</p>
              <p className="text-xs text-slate-400 mt-1 uppercase tracking-wide">{s.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
