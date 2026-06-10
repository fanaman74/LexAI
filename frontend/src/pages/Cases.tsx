import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Case } from "../api";

export default function Cases() {
  const [cases, setCases] = useState<Case[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = useCallback(() => {
    api<{ cases: Case[] }>("/api/cases").then((r) => setCases(r.cases)).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function createCase(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const c = await api<Case>("/api/cases", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
      });
      setCases((prev) => [c, ...prev]);
      setNewName("");
      setNewDesc("");
      setShowForm(false);
    } finally {
      setCreating(false);
    }
  }

  async function deleteCase(id: number) {
    await api("/api/cases/" + id, { method: "DELETE" });
    setCases((prev) => prev.filter((c) => c.id !== id));
    setConfirmDelete(null);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white px-4 sm:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cases</h1>
          <p className="text-zinc-400 text-sm mt-1">{cases.length} case{cases.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-5 py-2 rounded-lg text-sm transition-colors"
        >
          + New Case
        </button>
      </div>

      {/* New case inline form */}
      {showForm && (
        <form
          onSubmit={createCase}
          className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6"
          style={{ animation: "fadeSlideUp 0.3s ease-out forwards" }}
        >
          <div className="flex flex-col sm:flex-row gap-4">
            <input
              autoFocus
              required
              placeholder="Case name *"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
            />
            <input
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-black font-semibold px-6 py-2 rounded-lg text-sm transition-colors"
              >
                {creating ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-zinc-400 hover:text-white px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Cases table */}
      {cases.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-16 text-center">
          <p className="text-zinc-500 text-lg">No cases yet</p>
          <p className="text-zinc-600 text-sm mt-2">Create a case and upload documents to get started</p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {/* Table header — hidden on mobile */}
          <div className="hidden sm:grid grid-cols-[1fr_80px_140px_100px] gap-4 px-6 py-3 border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wide">
            <span>Name</span>
            <span>Files</span>
            <span>Created</span>
            <span></span>
          </div>

          {cases.map((c, i) => (
            <div key={c.id} className={i > 0 ? "border-t border-zinc-800" : ""}>
              {/* Row */}
              <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_80px_140px_100px] gap-2 sm:gap-4 px-6 py-4 hover:bg-zinc-800/50 transition-colors items-center">
                <button
                  onClick={() => toggleExpand(c.id)}
                  className="text-left font-medium text-white hover:text-amber-400 transition-colors flex items-center gap-2"
                >
                  <span className={`text-zinc-500 transition-transform inline-block ${expanded.has(c.id) ? "rotate-90" : ""}`}>▶</span>
                  <span>{c.name}</span>
                </button>
                <span className="text-zinc-400 text-sm hidden sm:block">{c.file_count}</span>
                <span className="text-zinc-500 text-xs hidden sm:block">
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
                <div className="flex justify-end">
                  {confirmDelete === c.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => deleteCase(c.id)}
                        className="text-xs text-red-400 hover:text-red-300 font-medium"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs text-zinc-500 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(c.id)}
                      className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                      title="Delete case"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded file list */}
              {expanded.has(c.id) && (
                <div className="border-t border-zinc-800/60 bg-zinc-950 px-6 py-4">
                  {c.files.length === 0 ? (
                    <p className="text-zinc-600 text-sm">No files in this case</p>
                  ) : (
                    <ul className="space-y-2">
                      {c.files.map((f) => (
                        <li key={f.id} className="flex items-center justify-between gap-4 text-sm">
                          <span className="text-zinc-300 truncate max-w-xs">{f.original_name}</span>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              f.status === "converted" ? "bg-emerald-900/50 text-emerald-400"
                              : f.status === "failed" ? "bg-red-900/50 text-red-400"
                              : "bg-zinc-800 text-zinc-400"
                            }`}>{f.status}</span>
                            {f.has_markdown && (
                              <Link
                                to={`/files/${f.id}`}
                                className="text-amber-400 hover:text-amber-300 text-xs"
                              >
                                View MD
                              </Link>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
