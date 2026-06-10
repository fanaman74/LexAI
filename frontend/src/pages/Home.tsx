import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Case, IndexStatus, ScanProgress } from "../api";

export default function Home() {
  const navigate = useNavigate();
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

  function startScan() {
    navigate("/folder-upload");
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center relative overflow-hidden px-6 py-16">
      {/* background glow */}
      <div className="absolute w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-6xl flex flex-col lg:flex-row items-center gap-12 lg:gap-20">

        {/* Left: text + CTAs */}
        <div
          className="flex-1 text-center lg:text-left opacity-0"
          style={{ animation: "fadeSlideUp 0.6s ease-out 0.1s forwards" }}
        >
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
            Your Legal Work,{" "}
            <span className="text-amber-400">Intelligently Organised</span>
          </h1>

          <p className="text-zinc-400 text-lg sm:text-xl mb-10 max-w-lg mx-auto lg:mx-0">
            Ingest case files, extract key facts with AI, and review everything in one place — entirely on your machine.
          </p>

          <div className="flex gap-4 justify-center lg:justify-start flex-wrap">
            <button
              onClick={openModal}
              disabled={uploading}
              className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-black rounded-xl px-8 py-3.5 font-semibold text-lg shadow-lg transition-colors"
            >
              {uploading ? "Uploading…" : "Upload Files"}
            </button>
            <button
              onClick={startScan}
              className="border border-amber-500/60 text-amber-400 hover:bg-amber-500/10 rounded-xl px-8 py-3.5 font-semibold text-lg transition-colors"
            >
              Add Folder
            </button>
          </div>

          {(scan || error) && (
            <div className="mt-6 text-sm">
              {error && <p className="text-red-400">{error}</p>}
              {scan && scan.status !== "done" && (
                <p className="text-zinc-400">Converting {scan.done}/{scan.total}…</p>
              )}
              {scan && scan.status === "done" && (
                <p className="text-emerald-400">Done: {scan.converted} converted · {scan.failed} failed</p>
              )}
            </div>
          )}

          <div className="mt-8">
            <Link to="/library" className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">
              Browse Library →
            </Link>
          </div>

          {stats && (
            <div
              className="mt-12 flex gap-4 justify-center lg:justify-start flex-wrap opacity-0"
              style={{ animation: "fadeSlideUp 0.6s ease-out 0.5s forwards" }}
            >
              {[
                { label: "Documents", value: stats.total },
                { label: "Indexed", value: stats.indexed },
                { label: "Failed", value: stats.failed },
              ].map((s) => (
                <div key={s.label} className="bg-zinc-950 border border-zinc-800 rounded-xl px-6 py-4 text-center min-w-[90px]">
                  <p className="text-2xl font-bold text-white">{s.value}</p>
                  <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wide">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: animated orbital circle */}
        <div
          className="shrink-0 opacity-0"
          style={{ animation: "fadeSlideUp 0.8s ease-out 0.3s forwards" }}
        >
          <svg viewBox="0 0 560 560" className="w-72 h-72 sm:w-80 sm:h-80 lg:w-[420px] lg:h-[420px]" aria-hidden="true">
            <defs>
              {/* orbit path: full circle, starting from top */}
              <path id="orbitPath" d="M280,120 A160,160 0 1,1 279.999,120" fill="none" />
            </defs>

            {/* outer faint guide ring */}
            <circle cx="280" cy="280" r="200" stroke="#27272A" strokeWidth="1" fill="none" />

            {/* main amber circle */}
            <circle cx="280" cy="280" r="160" stroke="#F59E0B" strokeWidth="1" fill="none" opacity="0.55" />

            {/* tick marks at N / S / E / W */}
            <line x1="280" y1="112" x2="280" y2="128" stroke="#F59E0B" strokeWidth="2" opacity="0.9" />
            <line x1="280" y1="432" x2="280" y2="448" stroke="#F59E0B" strokeWidth="2" opacity="0.9" />
            <line x1="112" y1="280" x2="128" y2="280" stroke="#F59E0B" strokeWidth="2" opacity="0.9" />
            <line x1="432" y1="280" x2="448" y2="280" stroke="#F59E0B" strokeWidth="2" opacity="0.9" />

            {/* × marks at 45° diagonals on circle edge */}
            {/* NE (393, 167) */}
            <line x1="388" y1="162" x2="398" y2="172" stroke="#52525B" strokeWidth="1.5" />
            <line x1="398" y1="162" x2="388" y2="172" stroke="#52525B" strokeWidth="1.5" />
            {/* NW (167, 167) */}
            <line x1="162" y1="162" x2="172" y2="172" stroke="#52525B" strokeWidth="1.5" />
            <line x1="172" y1="162" x2="162" y2="172" stroke="#52525B" strokeWidth="1.5" />
            {/* SE (393, 393) */}
            <line x1="388" y1="388" x2="398" y2="398" stroke="#52525B" strokeWidth="1.5" />
            <line x1="398" y1="388" x2="388" y2="398" stroke="#52525B" strokeWidth="1.5" />
            {/* SW (167, 393) */}
            <line x1="162" y1="388" x2="172" y2="398" stroke="#52525B" strokeWidth="1.5" />
            <line x1="172" y1="388" x2="162" y2="398" stroke="#52525B" strokeWidth="1.5" />

            {/* center label */}
            <text x="280" y="276" textAnchor="middle" fill="#52525B" fontSize="10" letterSpacing="4" fontFamily="monospace" fontWeight="500">LEX AI</text>
            <text x="280" y="292" textAnchor="middle" fill="#3F3F46" fontSize="9" letterSpacing="2" fontFamily="monospace">v2</text>

            {/* orbiting amber dot */}
            <circle r="7" fill="#F59E0B">
              <animateMotion dur="12s" repeatCount="indefinite" rotate="0">
                <mpath href="#orbitPath" />
              </animateMotion>
            </circle>
            {/* dot glow */}
            <circle r="14" fill="#F59E0B" opacity="0.15">
              <animateMotion dur="12s" repeatCount="indefinite" rotate="0">
                <mpath href="#orbitPath" />
              </animateMotion>
            </circle>

            {/* phase label — INGEST (top) */}
            <text x="280" y="58" textAnchor="middle" fill="white" fontSize="13" fontWeight="700" letterSpacing="0.5">Ingest</text>
            <text x="280" y="74" textAnchor="middle" fill="#71717A" fontSize="10">Upload &amp; process documents</text>

            {/* phase label — ANALYZE (right) */}
            <text x="466" y="275" textAnchor="start" fill="white" fontSize="13" fontWeight="700" letterSpacing="0.5">Analyze</text>
            <text x="466" y="291" textAnchor="start" fill="#71717A" fontSize="10">AI legal intelligence</text>

            {/* phase label — REVIEW (bottom) */}
            <text x="280" y="488" textAnchor="middle" fill="white" fontSize="13" fontWeight="700" letterSpacing="0.5">Review</text>
            <text x="280" y="504" textAnchor="middle" fill="#71717A" fontSize="10">Work cases end-to-end</text>

            {/* phase label — DISCOVER (left) */}
            <text x="94" y="275" textAnchor="end" fill="white" fontSize="13" fontWeight="700" letterSpacing="0.5">Discover</text>
            <text x="94" y="291" textAnchor="end" fill="#71717A" fontSize="10">Semantic search</text>
          </svg>
        </div>
      </div>

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
