import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Case, IndexStatus, ScanProgress } from "../api";

export default function Home() {
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<{ total: number; indexed: number; failed: number } | null>(null);
  const pollRef = useRef<number | null>(null);

  // Upload modal state
  const [showModal, setShowModal] = useState(false);
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("__none__");
  const [newCaseName, setNewCaseName] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

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

  function openModal() {
    api<{ cases: Case[] }>("/api/cases").then((r) => setCases(r.cases)).catch(() => {});
    setShowModal(true);
  }

  function closeModal() {
    if (uploading) return;
    setShowModal(false);
    setPendingFiles([]);
    setSelectedCaseId("__none__");
    setNewCaseName("");
  }

  async function handleModalUpload(e: React.FormEvent) {
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

      setShowModal(false);
      setPendingFiles([]);
      setSelectedCaseId("__none__");
      setNewCaseName("");
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
          className="text-3xl sm:text-5xl font-bold text-white mb-4 opacity-0"
          style={{ animation: "fadeSlideUp 0.6s ease-out 0.1s forwards" }}
        >
          Your Legal Documents,{" "}
          <span className="text-indigo-400">Intelligently Organized</span>
        </h1>

        <p
          className="text-slate-300 text-base sm:text-xl mb-10 opacity-0"
          style={{ animation: "fadeSlideUp 0.6s ease-out 0.3s forwards" }}
        >
          Ingest, search, and analyze case files with AI — entirely on your machine.
        </p>

        <div
          className="flex gap-4 justify-center flex-wrap opacity-0"
          style={{ animation: "fadeSlideUp 0.6s ease-out 0.5s forwards" }}
        >
          <button
            onClick={openModal}
            disabled={uploading}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-600 text-white rounded-xl px-6 sm:px-8 py-3.5 font-semibold text-base sm:text-lg shadow-lg transition-colors"
          >
            {uploading ? "Uploading…" : "Upload Files"}
          </button>
          <button
            onClick={startScan}
            className="border border-indigo-400 text-indigo-300 hover:bg-indigo-900/40 rounded-xl px-6 sm:px-8 py-3.5 font-semibold text-base sm:text-lg transition-colors"
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
          <Link to="/library" className="text-slate-400 hover:text-white text-sm transition-colors">
            Browse Library →
          </Link>
        </div>
      </div>

      {stats && (
        <div
          className="absolute bottom-8 sm:bottom-12 flex gap-3 sm:gap-6 opacity-0 px-4 flex-wrap justify-center"
          style={{ animation: "fadeSlideUp 0.6s ease-out 0.9s forwards" }}
        >
          {[
            { label: "Documents", value: stats.total },
            { label: "Indexed Chunks", value: stats.indexed },
            { label: "Failed", value: stats.failed },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white/5 backdrop-blur border border-white/10 rounded-xl px-6 sm:px-8 py-4 text-center"
            >
              <p className="text-2xl sm:text-3xl font-bold text-white">{s.value}</p>
              <p className="text-xs text-slate-400 mt-1 uppercase tracking-wide">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Upload modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 w-full max-w-md"
            style={{ animation: "fadeSlideUp 0.2s ease-out forwards" }}
          >
            <h2 className="text-white font-bold text-xl mb-1">Upload Files</h2>
            <p className="text-zinc-400 text-sm mb-6">Optionally assign to a case</p>

            <form onSubmit={handleModalUpload} className="space-y-5">
              {/* File picker */}
              <div>
                <label className="block text-zinc-300 text-sm font-medium mb-2">Files *</label>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.doc,.msg,.eml,.xlsx,.csv,.txt,.rtf"
                  required
                  onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []))}
                  className="w-full text-zinc-300 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-zinc-800 file:text-zinc-300 file:hover:bg-zinc-700 file:cursor-pointer file:transition-colors"
                />
                {pendingFiles.length > 0 && (
                  <p className="text-zinc-500 text-xs mt-1">
                    {pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""} selected
                  </p>
                )}
              </div>

              {/* Case selector */}
              <div>
                <label className="block text-zinc-300 text-sm font-medium mb-2">Case (optional)</label>
                <select
                  value={selectedCaseId}
                  onChange={(e) => setSelectedCaseId(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-300 text-sm focus:outline-none focus:border-amber-500"
                >
                  <option value="__none__">— No case —</option>
                  {cases.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                  <option value="__new__">+ New case…</option>
                </select>
              </div>

              {/* New case name input */}
              {selectedCaseId === "__new__" && (
                <div>
                  <input
                    autoFocus
                    placeholder="Case name *"
                    value={newCaseName}
                    onChange={(e) => setNewCaseName(e.target.value)}
                    required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={uploading || pendingFiles.length === 0}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-black font-semibold py-2.5 rounded-lg text-sm transition-colors"
                >
                  {uploading ? "Uploading…" : "Upload"}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="text-zinc-400 hover:text-white px-4 py-2.5 text-sm"
                >
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
