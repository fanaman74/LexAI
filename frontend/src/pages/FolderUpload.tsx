import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Case, ScanProgress } from "../api";


export default function FolderUpload() {
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("__none__");
  const [newCaseName, setNewCaseName] = useState("");

  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [, setFiles] = useState<string[]>([]);
  const [error, setError] = useState("");
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    api<{ cases: Case[] }>("/api/cases").then((r) => setCases(r.cases)).catch(() => {});
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  function startPoll(job_id: string) {
    stopPoll();
    pollRef.current = window.setInterval(async () => {
      try {
        const prog = await api<ScanProgress>(`/api/scan/${job_id}`);
        setProgress(prog);
        // rebuild file list from skipped + totals
        setFiles(prog.skipped ?? []);
        if (prog.status === "done") {
          stopPoll();
          setScanning(false);
        }
      } catch {
        stopPoll();
        setScanning(false);
        setError("Lost contact with server — please try again.");
      }
    }, 600);
  }

  async function pickAndScan() {
    setError("");
    setPicking(true);
    try {
      const picked = await api<{ path: string | null }>("/api/pick-folder", { method: "POST" });
      if (!picked.path) { setPicking(false); return; }
      setFolderPath(picked.path);
      setPicking(false);
      await runScan(picked.path);
    } catch (e) {
      setError((e as Error).message);
      setPicking(false);
    }
  }

  async function runScan(path: string) {
    setScanning(true);
    setProgress(null);
    setFiles([]);
    setError("");
    try {
      let caseId: number | null = null;
      if (selectedCaseId === "__new__" && newCaseName.trim()) {
        const c = await api<Case>("/api/cases", {
          method: "POST",
          body: JSON.stringify({ name: newCaseName.trim() }),
        });
        caseId = c.id;
        setCases((prev) => [...prev, c]);
        setSelectedCaseId(String(c.id));
        setNewCaseName("");
      } else if (selectedCaseId && selectedCaseId !== "__none__") {
        caseId = parseInt(selectedCaseId, 10);
      }

      const { job_id } = await api<{ job_id: string }>("/api/scan", {
        method: "POST",
        body: JSON.stringify({ path, case_id: caseId }),
      });
      startPoll(job_id);
    } catch (e) {
      setError((e as Error).message);
      setScanning(false);
    }
  }

  const done = progress?.status === "done";
  const pct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  // Derive per-file rows from progress counters + skipped list
  const skippedNames: string[] = progress?.skipped ?? [];
  const convertedCount = progress?.converted ?? 0;
  const failedCount = (progress?.failed ?? 0);

  return (
    <div className="min-h-screen bg-black px-6 py-12 max-w-3xl mx-auto">
      <div className="mb-10" style={{ animation: "fadeSlideUp 0.5s ease-out forwards" }}>
        <h1 className="text-3xl font-bold text-white mb-2">Add Folder</h1>
        <p className="text-zinc-500 text-sm">Select a folder from your machine — all supported files inside will be ingested and converted.</p>
      </div>

      {/* Case selector */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 mb-6" style={{ animation: "fadeSlideUp 0.5s ease-out 0.1s forwards", opacity: 0 }}>
        <label className="block text-zinc-300 text-sm font-medium mb-3">Assign to Case <span className="text-zinc-600">(optional)</span></label>
        <select
          value={selectedCaseId}
          onChange={(e) => setSelectedCaseId(e.target.value)}
          disabled={scanning}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-300 text-sm focus:outline-none focus:border-amber-500 disabled:opacity-50"
        >
          <option value="__none__">— No case —</option>
          {cases.map((c) => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
          <option value="__new__">+ New case…</option>
        </select>
        {selectedCaseId === "__new__" && (
          <input
            autoFocus
            placeholder="Case name *"
            value={newCaseName}
            onChange={(e) => setNewCaseName(e.target.value)}
            disabled={scanning}
            className="mt-3 w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-amber-500 disabled:opacity-50"
          />
        )}
      </div>

      {/* Pick folder button */}
      <div className="mb-8" style={{ animation: "fadeSlideUp 0.5s ease-out 0.2s forwards", opacity: 0 }}>
        <button
          onClick={pickAndScan}
          disabled={picking || scanning || (selectedCaseId === "__new__" && !newCaseName.trim())}
          className="flex items-center gap-3 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-semibold rounded-xl px-8 py-4 text-base transition-colors shadow-lg"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          {picking ? "Opening picker…" : scanning ? "Ingesting…" : "Select Folder"}
        </button>
        {folderPath && (
          <p className="mt-3 text-zinc-500 text-xs font-mono truncate">{folderPath}</p>
        )}
      </div>

      {error && <p className="text-red-400 text-sm mb-6">{error}</p>}

      {/* Progress + file list */}
      {progress && (
        <div style={{ animation: "fadeSlideUp 0.4s ease-out forwards" }}>
          {/* Progress bar */}
          {!done && (
            <div className="mb-6">
              <div className="flex justify-between text-xs text-zinc-500 mb-2">
                <span>{progress.status === "scanning" ? "Scanning folder…" : `Converting ${progress.done} / ${progress.total}`}</span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {/* Summary when done */}
          {done && (
            <div className="flex gap-4 mb-6 flex-wrap">
              {[
                { label: "Total", value: progress.total, color: "text-white" },
                { label: "Converted", value: convertedCount, color: "text-emerald-400" },
                { label: "Existing", value: progress.existing, color: "text-zinc-400" },
                { label: "Failed", value: failedCount + skippedNames.length, color: "text-red-400" },
              ].map((s) => (
                <div key={s.label} className="bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-3 text-center min-w-[80px]">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-zinc-600 mt-0.5 uppercase tracking-wide">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Skipped/unsupported file list */}
          {skippedNames.length > 0 && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Skipped — unsupported format</p>
              </div>
              <ul className="divide-y divide-zinc-900 max-h-64 overflow-y-auto">
                {skippedNames.map((name, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-2 h-2 rounded-full bg-zinc-700 shrink-0" />
                    <span className="text-zinc-500 text-sm font-mono truncate">{name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* In-progress file count */}
          {!done && progress.total > 0 && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-400">
              Processing {progress.total} file{progress.total !== 1 ? "s" : ""}
              {convertedCount > 0 && <> · <span className="text-emerald-400">{convertedCount} converted</span></>}
              {failedCount > 0 && <> · <span className="text-red-400">{failedCount} failed</span></>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
