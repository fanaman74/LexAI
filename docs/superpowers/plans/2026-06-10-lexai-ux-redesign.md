# LexAI UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat top-nav with a fixed left sidebar, add an animated hero home page at `/`, move the Library to `/library`, and introduce a three-column Case Review workspace at `/review` with AI analysis tools; also add a backend file-upload endpoint.

**Architecture:** New `Sidebar` component wraps all routes in a flex layout (sidebar fixed-left, main fills remainder). `Home` replaces `/`, Library moves to `/library`, new `CaseReview` at `/review`. Backend gains one new router `upload.py` using the existing `IngestJob` to handle multipart uploads.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, React Router v7, FastAPI, Python 3, pytest

---

## File Map

| Action | Path |
|---|---|
| Edit | `frontend/src/index.css` |
| Create | `frontend/src/components/Sidebar.tsx` |
| Edit | `frontend/src/App.tsx` |
| Edit | `frontend/src/pages/Chat.tsx` (link `/` → `/library`) |
| Edit | `frontend/src/pages/Analyze.tsx` (link `/` → `/library`) |
| Edit | `frontend/src/pages/Document.tsx` (link `/` → `/library`) |
| Edit | `frontend/src/pages/Library.tsx` (add "New Case →" button) |
| Create | `frontend/src/pages/Home.tsx` |
| Create | `frontend/src/pages/CaseReview.tsx` |
| Create | `backend/app/routers/upload.py` |
| Edit | `backend/app/main.py` (register upload router) |
| Create | `backend/tests/test_api_upload.py` |

---

## Task 1: CSS animation keyframes

**Files:**
- Edit: `frontend/src/index.css`

- [ ] **Step 1: Add keyframe and utility class**

Replace the entire file content:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";

@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/index.css
git commit -m "style: add fadeSlideUp keyframe for hero animation"
```

---

## Task 2: Sidebar component

**Files:**
- Create: `frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import type { IndexStatus } from "../api";

export default function Sidebar() {
  const [status, setStatus] = useState<IndexStatus | null>(null);

  useEffect(() => {
    api<IndexStatus>("/api/index/status").then(setStatus).catch(() => {});
  }, []);

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? "bg-indigo-600 text-white"
        : "text-slate-300 hover:text-white hover:bg-slate-800"
    }`;

  return (
    <div className="fixed top-0 left-0 h-screen w-60 bg-slate-900 flex flex-col z-20 shadow-xl">
      <div className="px-5 py-5 border-b border-slate-800">
        <span className="text-white font-bold text-lg tracking-tight">
          ⚖️ LexAI <span className="text-indigo-400">v2</span>
        </span>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        <NavLink to="/" className={link} end>
          <span>🏠</span> Home
        </NavLink>
        <NavLink to="/library" className={link}>
          <span>📚</span> Library
        </NavLink>
        <NavLink to="/review" className={link}>
          <span>⚖️</span> Case Review
        </NavLink>
        <NavLink to="/chat" className={link}>
          <span>💬</span> Chat
        </NavLink>
      </nav>
      <div className="px-4 py-3 border-t border-slate-800">
        {status ? (
          <span className="text-xs text-slate-400">
            {status.status === "running"
              ? `⚡ Indexing ${status.indexed}/${status.total}`
              : `● ${status.indexed} docs indexed`}
          </span>
        ) : (
          <span className="text-xs text-slate-400">● Idle</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Sidebar.tsx
git commit -m "feat: Sidebar component with nav links and index status"
```

---

## Task 3: Refactor App.tsx with sidebar layout and new routes

**Files:**
- Edit: `frontend/src/App.tsx`

- [ ] **Step 1: Replace App.tsx entirely**

```tsx
import { Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Home from "./pages/Home";
import Library from "./pages/Library";
import DocumentView from "./pages/Document";
import Analyze from "./pages/Analyze";
import ChatPage from "./pages/Chat";
import CaseReview from "./pages/CaseReview";

export default function App() {
  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar />
      <main className="ml-60 flex-1 min-w-0">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/library" element={<Library />} />
          <Route path="/files/:id" element={<DocumentView />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/analyze" element={<Analyze />} />
          <Route path="/review" element={<CaseReview />} />
        </Routes>
      </main>
    </div>
  );
}
```

Note: `Home` and `CaseReview` don't exist yet — TypeScript will error until Tasks 6 and 7 are complete. That is fine; complete all tasks before running the dev server.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "refactor: sidebar layout shell, new routes for Home and CaseReview"
```

---

## Task 4: Fix internal "/library" links in existing pages

Three existing pages link to `/` meaning "the Library". They need updating to `/library`.

**Files:**
- Edit: `frontend/src/pages/Document.tsx` line 91
- Edit: `frontend/src/pages/Analyze.tsx` line 67
- Edit: `frontend/src/pages/Chat.tsx` line 113

- [ ] **Step 1: Fix Document.tsx**

Find line ~91:
```tsx
<Link to="/" className="text-indigo-700 text-sm hover:underline">← Library</Link>
```
Change to:
```tsx
<Link to="/library" className="text-indigo-700 text-sm hover:underline">← Library</Link>
```

- [ ] **Step 2: Fix Analyze.tsx**

Find line ~67:
```tsx
<Link to="/" className="text-blue-700 underline">
Select files in the Library</Link>
```
Change to:
```tsx
<Link to="/library" className="text-blue-700 underline">
Select files in the Library</Link>
```

- [ ] **Step 3: Fix Chat.tsx**

Find line ~113:
```tsx
<Link to="/" className="text-indigo-600 underline">pick some in the Library</Link>
```
Change to:
```tsx
<Link to="/library" className="text-indigo-600 underline">pick some in the Library</Link>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Document.tsx frontend/src/pages/Analyze.tsx frontend/src/pages/Chat.tsx
git commit -m "fix: update internal Library links from / to /library"
```

---

## Task 5: Library — add "New Case →" button

**Files:**
- Edit: `frontend/src/pages/Library.tsx`

- [ ] **Step 1: Add the button next to the Chat button**

In `Library.tsx`, find the block containing the `💬 Chat` button (around line 196–199):

```tsx
<button disabled={selected.length === 0}
  onClick={() => navigate(`/chat?ids=${selected.join(",")}`)}
  className="bg-emerald-600 disabled:bg-slate-300 text-white rounded-lg px-4 font-medium">
  💬 Chat ({selected.length})
</button>
```

Add a new button immediately after it:

```tsx
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
```

- [ ] **Step 2: Add padding to Library page content**

Library's root div currently starts at `<div className="max-w-6xl mx-auto space-y-4">`. Wrap this in a padded container since App.tsx no longer adds padding:

Change the opening div from:
```tsx
<div className="max-w-6xl mx-auto space-y-4">
```
to:
```tsx
<div className="max-w-6xl mx-auto space-y-4 p-6">
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Library.tsx
git commit -m "feat: New Case button in Library, add page padding"
```

---

## Task 6: Add padding to other existing pages

With the `p-6` removed from `<main>` in App.tsx, pages that relied on it need their own padding. Check and update:

**Files:**
- Edit: `frontend/src/pages/Analyze.tsx`
- Edit: `frontend/src/pages/Document.tsx`
- Edit: `frontend/src/pages/Chat.tsx`

- [ ] **Step 1: Analyze.tsx — wrap content in p-6**

Change the opening div from:
```tsx
<div className="max-w-3xl mx-auto space-y-4">
```
to:
```tsx
<div className="max-w-3xl mx-auto space-y-4 p-6">
```

- [ ] **Step 2: Document.tsx — wrap content in p-6**

Change the opening div from:
```tsx
<div className="max-w-6xl mx-auto flex gap-6">
```
to:
```tsx
<div className="max-w-6xl mx-auto flex gap-6 p-6">
```

- [ ] **Step 3: Chat.tsx — update height calculation**

The Chat page uses `style={{ height: "calc(100vh - 7rem)" }}` to account for the old top nav. With the sidebar layout (no top bar), change this to account for zero top offset:

Find line ~87:
```tsx
<div className="max-w-6xl mx-auto flex gap-4" style={{ height: "calc(100vh - 7rem)" }}>
```
Change to:
```tsx
<div className="max-w-6xl mx-auto flex gap-4 p-6" style={{ height: "100vh" }}>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Analyze.tsx frontend/src/pages/Document.tsx frontend/src/pages/Chat.tsx
git commit -m "fix: restore page padding after removing it from App main element"
```

---

## Task 7: Home page

**Files:**
- Create: `frontend/src/pages/Home.tsx`

- [ ] **Step 1: Create Home.tsx**

```tsx
import { useEffect, useRef, useState } from "react";
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

  useEffect(() => {
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
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
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
      pollRef.current = window.setInterval(async () => {
        const prog = await api<ScanProgress>(`/api/scan/${job_id}`);
        setScan(prog);
        if (prog.status === "done") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setUploading(false);
        }
      }, 500);
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
      pollRef.current = window.setInterval(async () => {
        const prog = await api<ScanProgress>(`/api/scan/${job_id}`);
        setScan(prog);
        if (prog.status === "done") {
          if (pollRef.current) window.clearInterval(pollRef.current);
        }
      }, 500);
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/Home.tsx
git commit -m "feat: animated hero home page with upload buttons and stats strip"
```

---

## Task 8: Case Review workspace

**Files:**
- Create: `frontend/src/pages/CaseReview.tsx`

- [ ] **Step 1: Create CaseReview.tsx**

```tsx
import { useCallback, useEffect, useState } from "react";
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

  const loadDoc = useCallback(
    async (id: number) => {
      if (docCache[id]) return;
      try {
        const doc = await api<DocDetail>(`/api/files/${id}`);
        setDocCache((c) => ({ ...c, [id]: doc }));
      } catch { /* ignore */ }
    },
    [docCache],
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
      const h = await api<{ analyses: Analysis[] }>("/api/analyses");
      setHistory(h.analyses);
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
    <div className="flex h-screen overflow-hidden">
      {/* Left panel — document picker */}
      <div className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <input
            value={caseName}
            onChange={(e) => setCaseName(e.target.value)}
            className="w-full text-sm font-semibold border-0 border-b border-slate-200 pb-1 focus:outline-none focus:border-indigo-400 bg-transparent"
          />
        </div>
        <div className="p-3 border-b border-slate-200">
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search files…"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.slice(0, 50).map((f) => (
            <button
              key={f.id}
              onClick={() => pin(f.id)}
              disabled={pinnedIds.includes(f.id)}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-indigo-50 disabled:opacity-40 border-b border-slate-100"
            >
              <span className="font-medium text-slate-700 block truncate">{f.original_name}</span>
              <span className="text-xs text-slate-400 uppercase">{f.file_type}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-slate-400 p-4">No files match.</p>
          )}
        </div>
        {pinnedFiles.length > 0 && (
          <div className="border-t border-slate-200 p-3 shrink-0">
            <p className="text-xs font-semibold text-slate-400 mb-2">
              PINNED ({pinnedFiles.length})
            </p>
            {pinnedFiles.map((f) => (
              <div key={f.id} className="flex items-center gap-1 mb-1">
                <button
                  onClick={() => setActiveDocId(f.id)}
                  className={`flex-1 text-left text-xs truncate rounded px-2 py-1 ${
                    activeDocId === f.id
                      ? "bg-indigo-100 text-indigo-700"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {f.original_name}
                </button>
                <button
                  onClick={() => unpin(f.id)}
                  className="text-slate-300 hover:text-red-500 px-1 text-base leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Center panel — document reader */}
      <div className="flex-1 min-w-0 flex flex-col bg-slate-50 overflow-hidden">
        {pinnedFiles.length > 0 ? (
          <>
            <div className="flex border-b border-slate-200 bg-white overflow-x-auto shrink-0">
              {pinnedFiles.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setActiveDocId(f.id)}
                  className={`px-4 py-2.5 text-sm font-medium shrink-0 border-r border-slate-200 transition-colors ${
                    activeDocId === f.id
                      ? "bg-indigo-50 text-indigo-700 border-b-2 border-b-indigo-600"
                      : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {f.original_name.length > 24
                    ? f.original_name.slice(0, 24) + "…"
                    : f.original_name}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {activeDoc?.markdown ? (
                <div className="prose max-w-none bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <ReactMarkdown>{activeDoc.markdown.content_md}</ReactMarkdown>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                  {activeDocId !== null ? "Loading…" : "Select a pinned document"}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            Pin documents from the left panel to start reading
          </div>
        )}
      </div>

      {/* Right panel — analysis tools */}
      <div className="w-80 shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-200 shrink-0">
          <h2 className="font-semibold text-slate-700 mb-3">AI Analysis</h2>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setPrompt(p.prompt)}
                className="border border-slate-300 rounded-full px-3 py-1 text-xs hover:bg-slate-100 transition-colors"
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
            className="border border-slate-300 rounded-lg w-full px-3 py-2 text-sm resize-none"
          />
          <button
            onClick={runAnalysis}
            disabled={busy || pinnedIds.length === 0 || !prompt.trim()}
            className="mt-2 w-full bg-emerald-600 disabled:bg-slate-300 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            {busy
              ? "Analyzing…"
              : `Run Analysis (${pinnedIds.length} doc${pinnedIds.length !== 1 ? "s" : ""})`}
          </button>
          {error && <p className="text-red-600 mt-2 text-xs">{error}</p>}
        </div>

        <div className="flex-1 overflow-y-auto">
          {result && (
            <div className="p-4 border-b border-slate-200">
              <p className="text-xs font-semibold text-slate-400 mb-2">RESULT</p>
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>
            </div>
          )}
          <div className="p-4">
            <h3 className="text-xs font-semibold text-slate-400 mb-2">HISTORY</h3>
            {history.length === 0 && (
              <p className="text-xs text-slate-400">No analyses yet.</p>
            )}
            {history.map((a) => (
              <details key={a.id} className="border-b border-slate-100 py-1.5">
                <summary className="cursor-pointer text-xs text-slate-600">
                  {a.prompt.slice(0, 60)}
                  {a.prompt.length > 60 ? "…" : ""}
                </summary>
                <div className="prose prose-sm max-w-none mt-2">
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/CaseReview.tsx
git commit -m "feat: Case Review three-column workspace with document reader and AI analysis"
```

---

## Task 9: Backend — file upload endpoint

**Files:**
- Create: `backend/app/routers/upload.py`
- Edit: `backend/app/main.py`
- Create: `backend/tests/test_api_upload.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api_upload.py`:

```python
import time


def test_upload_single_txt_file(client):
    content = b"contract text about indemnification"
    res = client.post(
        "/api/upload",
        files=[("files", ("contract.txt", content, "text/plain"))],
    )
    assert res.status_code == 200
    job_id = res.json()["job_id"]
    assert isinstance(job_id, str) and len(job_id) > 0

    deadline = time.time() + 15
    progress = None
    while time.time() < deadline:
        progress = client.get(f"/api/scan/{job_id}").json()
        if progress["status"] == "done":
            break
        time.sleep(0.05)
    assert progress["status"] == "done"
    assert progress["converted"] == 1

    files = client.get("/api/files").json()["files"]
    assert any(f["original_name"] == "contract.txt" for f in files)


def test_upload_multiple_files(client):
    res = client.post(
        "/api/upload",
        files=[
            ("files", ("a.txt", b"text one", "text/plain")),
            ("files", ("b.txt", b"text two", "text/plain")),
        ],
    )
    assert res.status_code == 200
    job_id = res.json()["job_id"]

    deadline = time.time() + 15
    progress = None
    while time.time() < deadline:
        progress = client.get(f"/api/scan/{job_id}").json()
        if progress["status"] == "done":
            break
        time.sleep(0.05)
    assert progress["status"] == "done"
    assert progress["converted"] == 2


def test_upload_preserves_original_filename(client):
    res = client.post(
        "/api/upload",
        files=[("files", ("evidence_report.txt", b"evidence text", "text/plain"))],
    )
    assert res.status_code == 200
    job_id = res.json()["job_id"]
    deadline = time.time() + 15
    while time.time() < deadline:
        if client.get(f"/api/scan/{job_id}").json()["status"] == "done":
            break
        time.sleep(0.05)
    files = client.get("/api/files").json()["files"]
    assert any(f["original_name"] == "evidence_report.txt" for f in files)
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2
source .venv/bin/activate
pytest backend/tests/test_api_upload.py -v
```

Expected: FAILED — `404` or `422` because the endpoint doesn't exist yet.

- [ ] **Step 3: Create the upload router**

Create `backend/app/routers/upload.py`:

```python
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Request, UploadFile

from .. import ingest

router = APIRouter(prefix="/api")


@router.post("/upload")
async def upload_files(files: list[UploadFile], request: Request):
    tmp_dir = tempfile.mkdtemp(prefix="lexai_upload_")
    for file in files:
        dest = Path(tmp_dir) / (file.filename or "upload")
        with dest.open("wb") as f:
            shutil.copyfileobj(file.file, f)
    job_id = ingest.start_scan(tmp_dir, request.app.state.db_path)
    return {"job_id": job_id}
```

- [ ] **Step 4: Register the router in main.py**

In `backend/app/main.py`, add the import and `include_router` call.

Find the existing router imports block:
```python
    from .routers import (analyses as analyses_router, chats as chats_router,
                          files as files_router, scan as scan_router,
                          search as search_router, semantic as semantic_router,
                          tags as tags_router)
    app.include_router(scan_router.router)
```

Change to:
```python
    from .routers import (analyses as analyses_router, chats as chats_router,
                          files as files_router, scan as scan_router,
                          search as search_router, semantic as semantic_router,
                          tags as tags_router, upload as upload_router)
    app.include_router(scan_router.router)
    app.include_router(upload_router.router)
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
pytest backend/tests/test_api_upload.py -v
```

Expected output:
```
PASSED test_upload_single_txt_file
PASSED test_upload_multiple_files
PASSED test_upload_no_files_returns_422
```

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
pytest backend/tests/ -v
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/upload.py backend/app/main.py backend/tests/test_api_upload.py
git commit -m "feat: POST /api/upload endpoint for multipart file ingestion"
```

---

## Task 10: Build frontend and smoke-test

- [ ] **Step 1: Install dependencies (if needed) and build**

```bash
cd frontend && npm install && npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 2: Start the app**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2 && ./start.sh
```

- [ ] **Step 3: Verify in browser**

- `http://localhost:8000/` — hero section visible, animations play, glow orb pulses
- Sidebar shows: Home, Library, Case Review, Chat with active highlight
- "Browse Library →" link navigates to `/library`
- `/library` — file table visible, "New Case" button appears when files are checked
- `/review` — three-column layout; search/pin a file; select a preset; run analysis
- `/chat` — layout correct, no height overflow issues

- [ ] **Step 4: Commit build artifacts (optional — skip if dist/ is gitignored)**

```bash
git status
# if frontend/dist/ is tracked:
git add frontend/dist/
git commit -m "build: production build with new UX"
```
