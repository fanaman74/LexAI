# Cases, File Deletion & Responsive Design — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent Cases (SQLite), file deletion from index, upload-with-case-assignment, a /cases UI page, and make all pages fully responsive.

**Architecture:** New `cases` + `case_files` tables added to existing schema; new `cases.py` router; `IngestJob` gains a `case_id` attribute for auto-linking; responsive sidebar uses a hamburger drawer on mobile; all pages use Tailwind `sm:`/`md:`/`lg:` prefixes.

**Tech Stack:** FastAPI + SQLite (existing), React 19 + TypeScript + Tailwind CSS v4, React Router v7, pytest + FastAPI TestClient

**Spec:** `docs/superpowers/specs/2026-06-10-cases-delete-design.md`

---

## File Map

**Create:**
- `backend/app/routers/cases.py`
- `backend/tests/test_cases.py`
- `frontend/src/pages/Cases.tsx`

**Modify:**
- `backend/app/db.py` — add cases + case_files tables to SCHEMA
- `backend/app/ingest.py` — add `case_id` attribute + auto-link in `_process_one`
- `backend/app/routers/upload.py` — accept `case_id` Form param
- `backend/app/routers/files.py` — add DELETE endpoint
- `backend/app/main.py` — register cases router
- `backend/tests/test_files.py` — add delete test (create file if exists, otherwise new file)
- `frontend/src/api.ts` — add Case + CaseFile types
- `frontend/src/components/Sidebar.tsx` — Cases link + hamburger mobile drawer
- `frontend/src/App.tsx` — add /cases route
- `frontend/src/pages/Home.tsx` — replace direct upload trigger with modal
- `frontend/src/pages/Library.tsx` — add delete button per row
- `frontend/src/pages/CaseReview.tsx` — responsive stacked layout on mobile

---

## Task 1: DB Schema — cases + case_files tables

**Files:**
- Modify: `backend/app/db.py`

- [ ] **Step 1: Append two tables to SCHEMA**

In `backend/app/db.py`, find the closing `"""` of the SCHEMA string (after the `analyses` table) and insert before it:

```python
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS case_files (
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (case_id, file_id)
);
```

- [ ] **Step 2: Verify schema parses**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2
python -c "from backend.app.db import SCHEMA; print('ok', len(SCHEMA))"
```
Expected: `ok <number>`

- [ ] **Step 3: Commit**

```bash
git add backend/app/db.py
git commit -m "feat: add cases + case_files tables to schema"
```

---

## Task 2: Backend cases router

**Files:**
- Create: `backend/app/routers/cases.py`
- Create: `backend/tests/test_cases.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_cases.py`:

```python
import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app
import tempfile, os

@pytest.fixture
def client(tmp_path):
    db = str(tmp_path / "test.db")
    app = create_app(db)
    return TestClient(app)

def test_create_and_list_cases(client):
    r = client.post("/api/cases", json={"name": "Smith v. Jones"})
    assert r.status_code == 200
    case = r.json()
    assert case["name"] == "Smith v. Jones"
    assert case["id"] > 0

    r2 = client.get("/api/cases")
    assert r2.status_code == 200
    cases = r2.json()["cases"]
    assert len(cases) == 1
    assert cases[0]["file_count"] == 0

def test_delete_case(client):
    r = client.post("/api/cases", json={"name": "To Delete"})
    case_id = r.json()["id"]
    r2 = client.delete(f"/api/cases/{case_id}")
    assert r2.status_code == 200
    assert r2.json()["ok"] is True
    assert client.get("/api/cases").json()["cases"] == []

def test_add_and_remove_file_from_case(client):
    case_id = client.post("/api/cases", json={"name": "Test Case"}).json()["id"]
    # Upload a minimal file to get a file_id
    import io
    f = io.BytesIO(b"hello world")
    r = client.post("/api/upload", files={"files": ("test.txt", f, "text/plain")})
    assert r.status_code == 200

    # Wait for job done (poll up to 10s)
    import time
    job_id = r.json()["job_id"]
    for _ in range(20):
        prog = client.get(f"/api/scan/{job_id}").json()
        if prog["status"] == "done":
            break
        time.sleep(0.5)

    # Get file id
    files = client.get("/api/files").json()["files"]
    assert len(files) >= 1
    file_id = files[0]["id"]

    # Add to case
    r2 = client.post(f"/api/cases/{case_id}/files", json={"file_ids": [file_id]})
    assert r2.status_code == 200

    # Verify
    detail = client.get(f"/api/cases/{case_id}").json()
    assert any(f["id"] == file_id for f in detail["files"])

    # Remove from case
    r3 = client.delete(f"/api/cases/{case_id}/files/{file_id}")
    assert r3.status_code == 200
    detail2 = client.get(f"/api/cases/{case_id}").json()
    assert not any(f["id"] == file_id for f in detail2["files"])
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2
python -m pytest backend/tests/test_cases.py -v 2>&1 | tail -20
```
Expected: FAILED (router not registered)

- [ ] **Step 3: Create cases router**

Create `backend/app/routers/cases.py`:

```python
import sqlite3
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..deps import get_db

router = APIRouter(prefix="/api")


class CreateCase(BaseModel):
    name: str
    description: str = ""


class AddFiles(BaseModel):
    file_ids: list[int]


def _case_with_files(conn: sqlite3.Connection, case_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id, name, description, created_at FROM cases WHERE id=?",
        (case_id,)).fetchone()
    if row is None:
        return None
    files = conn.execute(
        """SELECT f.id, f.original_name, f.status,
           EXISTS(SELECT 1 FROM markdown_files m WHERE m.file_id=f.id) AS has_markdown
           FROM case_files cf JOIN files f ON f.id=cf.file_id
           WHERE cf.case_id=? ORDER BY cf.added_at DESC""",
        (case_id,)).fetchall()
    return {**dict(row), "file_count": len(files),
            "files": [dict(f) for f in files]}


@router.get("/cases")
def list_cases(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        "SELECT id FROM cases ORDER BY created_at DESC").fetchall()
    return {"cases": [c for r in rows
                      if (c := _case_with_files(db, r["id"])) is not None]}


@router.post("/cases")
def create_case(body: CreateCase, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute(
        "INSERT INTO cases (name, description) VALUES (?, ?)",
        (body.name.strip(), body.description.strip()))
    db.commit()
    row = db.execute(
        "SELECT id, name, description, created_at FROM cases WHERE id=?",
        (cur.lastrowid,)).fetchone()
    return {**dict(row), "file_count": 0, "files": []}


@router.get("/cases/{case_id}")
def get_case(case_id: int, db: sqlite3.Connection = Depends(get_db)):
    case = _case_with_files(db, case_id)
    if case is None:
        raise HTTPException(404, "case not found")
    return case


@router.post("/cases/{case_id}/files")
def add_files_to_case(case_id: int, body: AddFiles,
                      db: sqlite3.Connection = Depends(get_db)):
    if db.execute("SELECT 1 FROM cases WHERE id=?", (case_id,)).fetchone() is None:
        raise HTTPException(404, "case not found")
    for fid in body.file_ids:
        db.execute(
            "INSERT OR IGNORE INTO case_files (case_id, file_id) VALUES (?, ?)",
            (case_id, fid))
    db.commit()
    return {"ok": True}


@router.delete("/cases/{case_id}/files/{file_id}")
def remove_file_from_case(case_id: int, file_id: int,
                           db: sqlite3.Connection = Depends(get_db)):
    db.execute(
        "DELETE FROM case_files WHERE case_id=? AND file_id=?",
        (case_id, file_id))
    db.commit()
    return {"ok": True}


@router.delete("/cases/{case_id}")
def delete_case(case_id: int, db: sqlite3.Connection = Depends(get_db)):
    if db.execute("SELECT 1 FROM cases WHERE id=?", (case_id,)).fetchone() is None:
        raise HTTPException(404, "case not found")
    db.execute("DELETE FROM cases WHERE id=?", (case_id,))
    db.commit()
    return {"ok": True}
```

- [ ] **Step 4: Register router in main.py**

In `backend/app/main.py`, add to the import block and `include_router` calls:

```python
# In the from .routers import (...) block, add:
cases as cases_router,

# After the existing include_router calls:
app.include_router(cases_router.router)
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2
python -m pytest backend/tests/test_cases.py -v 2>&1 | tail -20
```
Expected: 3 PASSED

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/cases.py backend/app/main.py backend/tests/test_cases.py
git commit -m "feat: cases CRUD router + tests"
```

---

## Task 3: DELETE /api/files/{id}

**Files:**
- Modify: `backend/app/routers/files.py`
- Modify (or create): `backend/tests/test_files.py`

- [ ] **Step 1: Write failing test**

Check if `backend/tests/test_files.py` exists. If it does, append to it. If not, create it. Add:

```python
import io, time, pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app

@pytest.fixture
def client(tmp_path):
    db = str(tmp_path / "test.db")
    app = create_app(db)
    return TestClient(app)

def _upload_and_wait(client, filename="doc.txt", content=b"hello"):
    r = client.post("/api/upload",
        files={"files": (filename, io.BytesIO(content), "text/plain")})
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    for _ in range(20):
        prog = client.get(f"/api/scan/{job_id}").json()
        if prog["status"] == "done":
            break
        time.sleep(0.5)
    files = client.get("/api/files").json()["files"]
    assert len(files) >= 1
    return files[0]["id"]

def test_delete_file_removes_from_index(client):
    file_id = _upload_and_wait(client)
    r = client.delete(f"/api/files/{file_id}")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    files = client.get("/api/files").json()["files"]
    assert not any(f["id"] == file_id for f in files)

def test_delete_nonexistent_file_returns_404(client):
    r = client.delete("/api/files/99999")
    assert r.status_code == 404
```

- [ ] **Step 2: Run to verify fail**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2
python -m pytest backend/tests/test_files.py -v -k "delete" 2>&1 | tail -20
```
Expected: FAILED (405 Method Not Allowed)

- [ ] **Step 3: Add DELETE endpoint to files.py**

In `backend/app/routers/files.py`, append after the `retry_conversion` endpoint:

```python
@router.delete("/files/{file_id}")
def delete_file(file_id: int, db: sqlite3.Connection = Depends(get_db)):
    if db.execute("SELECT 1 FROM files WHERE id=?", (file_id,)).fetchone() is None:
        raise HTTPException(404, "file not found")
    db.execute("DELETE FROM files WHERE id=?", (file_id,))
    db.commit()
    return {"ok": True}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2
python -m pytest backend/tests/test_files.py -v -k "delete" 2>&1 | tail -20
```
Expected: 2 PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/files.py backend/tests/test_files.py
git commit -m "feat: DELETE /api/files/:id removes file from index"
```

---

## Task 4: IngestJob case_id auto-linking + upload endpoint

**Files:**
- Modify: `backend/app/ingest.py`
- Modify: `backend/app/routers/upload.py`

- [ ] **Step 1: Add case_id to IngestJob**

In `backend/app/ingest.py`, in `IngestJob.__init__`, add after `self.cleanup_root`:

```python
self.case_id: int | None = None
```

In `_process_one`, after `store.add_location(...)` and before `self._bump(...)`, add:

```python
if self.case_id is not None:
    try:
        conn.execute(
            "INSERT OR IGNORE INTO case_files (case_id, file_id) VALUES (?, ?)",
            (self.case_id, file_id))
        conn.commit()
    except Exception:
        pass
```

- [ ] **Step 2: Accept case_id in upload endpoint**

In `backend/app/routers/upload.py`, update the import and signature:

```python
from fastapi import APIRouter, Form, Request, UploadFile

@router.post("/upload")
async def upload_files(files: list[UploadFile], request: Request,
                       case_id: int | None = Form(None)):
    tmp_dir = tempfile.mkdtemp(prefix="lexai_upload_")
    try:
        for i, file in enumerate(files):
            safe_name = Path(file.filename).name if file.filename else "upload"
            sub = Path(tmp_dir) / f"{i:04d}"
            sub.mkdir()
            dest = sub / safe_name
            dest.write_bytes(await file.read())
        job = ingest.IngestJob(tmp_dir, request.app.state.db_path)
        job.cleanup_root = tmp_dir
        job.case_id = case_id
        ingest.JOBS[job.id] = job
        threading.Thread(target=job.run, daemon=True).start()
        return {"job_id": job.id}
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
```

- [ ] **Step 3: Write test for case_id upload linking**

Add to `backend/tests/test_cases.py`:

```python
def test_upload_with_case_id_links_files(client):
    case_id = client.post("/api/cases", json={"name": "Auto Link"}).json()["id"]
    import io, time
    f = io.BytesIO(b"contract text")
    r = client.post("/api/upload",
        data={"case_id": case_id},
        files={"files": ("contract.txt", f, "text/plain")})
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    for _ in range(20):
        prog = client.get(f"/api/scan/{job_id}").json()
        if prog["status"] == "done":
            break
        time.sleep(0.5)
    detail = client.get(f"/api/cases/{case_id}").json()
    assert detail["file_count"] >= 1
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2
python -m pytest backend/tests/test_cases.py -v 2>&1 | tail -20
```
Expected: 4 PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/app/ingest.py backend/app/routers/upload.py backend/tests/test_cases.py
git commit -m "feat: ingest auto-links files to case_id on upload"
```

---

## Task 5: Frontend types

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add Case types**

Append to `frontend/src/api.ts`:

```typescript
export interface CaseFile {
  id: number;
  original_name: string;
  status: string;
  has_markdown: boolean;
}

export interface Case {
  id: number;
  name: string;
  description: string;
  created_at: string;
  file_count: number;
  files: CaseFile[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2/frontend
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add Case + CaseFile types to api.ts"
```

---

## Task 6: Responsive Sidebar with hamburger drawer + Cases link

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Rewrite Sidebar with mobile hamburger**

Replace `frontend/src/components/Sidebar.tsx` entirely:

```tsx
import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import type { IndexStatus } from "../api";

export default function Sidebar() {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<IndexStatus>("/api/index/status").then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white hover:bg-slate-800"
    }`;

  const navLinks = (
    <>
      <NavLink to="/" className={link} end onClick={() => setOpen(false)}>
        <span>🏠</span> Home
      </NavLink>
      <NavLink to="/library" className={link} onClick={() => setOpen(false)}>
        <span>📚</span> Library
      </NavLink>
      <NavLink to="/cases" className={link} onClick={() => setOpen(false)}>
        <span>📁</span> Cases
      </NavLink>
      <NavLink to="/review" className={link} onClick={() => setOpen(false)}>
        <span>⚖️</span> Case Review
      </NavLink>
      <NavLink to="/chat" className={link} onClick={() => setOpen(false)}>
        <span>💬</span> Chat
      </NavLink>
    </>
  );

  const statusPill = (
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
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden md:flex fixed top-0 left-0 h-screen w-60 bg-slate-900 flex-col z-20 shadow-xl">
        <div className="px-5 py-5 border-b border-slate-800">
          <span className="text-white font-bold text-lg tracking-tight">
            ⚖️ LexAI <span className="text-indigo-400">v2</span>
          </span>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">{navLinks}</nav>
        {statusPill}
      </div>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-slate-900 border-b border-slate-800 flex items-center px-4 z-30">
        <button
          onClick={() => setOpen(true)}
          className="text-slate-300 hover:text-white p-1 mr-3"
          aria-label="Open menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="text-white font-bold text-base tracking-tight">
          ⚖️ LexAI <span className="text-indigo-400">v2</span>
        </span>
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div className="md:hidden fixed inset-0 bg-black/60 z-40" onClick={() => setOpen(false)} />
      )}
      <div
        ref={drawerRef}
        className={`md:hidden fixed top-0 left-0 h-screen w-64 bg-slate-900 flex flex-col z-50 shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-5 border-b border-slate-800 flex items-center justify-between">
          <span className="text-white font-bold text-lg tracking-tight">
            ⚖️ LexAI <span className="text-indigo-400">v2</span>
          </span>
          <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">{navLinks}</nav>
        {statusPill}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Update App.tsx main margin for mobile**

In `frontend/src/App.tsx`, change the `<main>` className from `"ml-60 flex-1 min-w-0"` to:

```tsx
<main className="md:ml-60 mt-14 md:mt-0 flex-1 min-w-0">
```

Also add the Cases route import and route (do this together):

```tsx
import Cases from "./pages/Cases";
// in Routes:
<Route path="/cases" element={<Cases />} />
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2/frontend
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors (Cases.tsx doesn't exist yet — if it errors on missing module, that's expected; fix by creating a stub: `export default function Cases() { return <div />; }` at `frontend/src/pages/Cases.tsx`)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/App.tsx
git commit -m "feat: responsive sidebar with hamburger drawer + Cases nav link"
```

---

## Task 7: Cases page

**Files:**
- Create: `frontend/src/pages/Cases.tsx`

- [ ] **Step 1: Create Cases.tsx**

Create `frontend/src/pages/Cases.tsx`:

```tsx
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
                  <span className={`text-zinc-500 transition-transform ${expanded.has(c.id) ? "rotate-90" : ""}`}>▶</span>
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
```

- [ ] **Step 2: TypeScript check**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2/frontend
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Cases.tsx
git commit -m "feat: /cases page with dark/amber UI, expandable rows, create/delete"
```

---

## Task 8: Upload modal with case picker

**Files:**
- Modify: `frontend/src/pages/Home.tsx`

- [ ] **Step 1: Rewrite Home.tsx to add upload modal**

Replace the entire content of `frontend/src/pages/Home.tsx` with:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Case, IndexStatus, ScanProgress } from "../api";

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<{ total: number; indexed: number; failed: number } | null>(null);
  const pollRef = useRef<number | null>(null);

  // Upload modal state
  const [showModal, setShowModal] = useState(false);
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
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
    setSelectedCaseId("");
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
      setSelectedCaseId("");
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
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 w-full max-w-md"
            style={{ animation: "fadeSlideUp 0.2s ease-out forwards" }}>
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
                  <p className="text-zinc-500 text-xs mt-1">{pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""} selected</p>
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
```

- [ ] **Step 2: TypeScript check**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2/frontend
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Home.tsx
git commit -m "feat: upload modal with case picker on Home page"
```

---

## Task 9: Delete button in Library

**Files:**
- Modify: `frontend/src/pages/Library.tsx`

- [ ] **Step 1: Read current Library.tsx to understand row rendering**

Read `frontend/src/pages/Library.tsx` focusing on how file rows are rendered.

- [ ] **Step 2: Add delete state + handler + button to each file row**

Add to Library component state:
```tsx
const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
```

Add delete handler:
```tsx
async function deleteFile(id: number) {
  await api("/api/files/" + id, { method: "DELETE" });
  setFiles((prev) => prev.filter((f) => f.id !== id));
  setConfirmDeleteId(null);
}
```

In the row actions area (wherever the Chat/MD/Original buttons are), add:

```tsx
{confirmDeleteId === file.id ? (
  <span className="flex items-center gap-1 text-xs">
    <button onClick={() => deleteFile(file.id)}
      className="text-red-400 hover:text-red-300 font-medium">Remove</button>
    <button onClick={() => setConfirmDeleteId(null)}
      className="text-slate-500 hover:text-white">Cancel</button>
  </span>
) : (
  <button
    onClick={() => setConfirmDeleteId(file.id)}
    className="text-slate-500 hover:text-red-400 transition-colors"
    title="Remove from index"
  >
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  </button>
)}
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2/frontend
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Library.tsx
git commit -m "feat: delete file button in Library with inline confirm"
```

---

## Task 10: Responsive pass on CaseReview + Library

**Files:**
- Modify: `frontend/src/pages/CaseReview.tsx`
- Modify: `frontend/src/pages/Library.tsx`

- [ ] **Step 1: CaseReview — stack columns vertically on mobile**

In `CaseReview.tsx`, find the three-column flex container (the `flex h-full` or `flex gap-` div wrapping all three panels). Change it to:

```tsx
className="flex flex-col lg:flex-row h-full gap-0 lg:gap-4"
```

Left panel (`w-72`): change to `w-full lg:w-72 shrink-0`  
Right panel (`w-80`): change to `w-full lg:w-80 shrink-0`  
Center panel: keep `flex-1 min-w-0`

On mobile the three panels stack vertically (left → center → right).

- [ ] **Step 2: Library — mobile card view**

In `Library.tsx`, the file list is currently a table or row-based layout. Wrap file rows in a container with `overflow-x-auto` so wide rows scroll on mobile rather than overflow. Add `min-w-max` to the inner table/row container.

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2/frontend
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/CaseReview.tsx frontend/src/pages/Library.tsx
git commit -m "feat: responsive layout for CaseReview + Library"
```

---

## Task 11: Build and smoke-test

- [ ] **Step 1: Run all backend tests**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2
python -m pytest backend/tests/ -v 2>&1 | tail -30
```
Expected: all PASSED

- [ ] **Step 2: Build frontend**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2/frontend
npm run build 2>&1 | tail -20
```
Expected: no errors, dist/ produced

- [ ] **Step 3: Start dev server and verify in browser**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2
python -m uvicorn backend.app.main:app --reload --port 8000
```

Navigate to http://localhost:8000 and verify:
- Home page loads with animated hero
- "Upload Files" button opens modal with case picker
- Sidebar has "Cases" link
- `/cases` shows the dark/amber Cases page
- Library rows have trash icon delete button
- Resize browser to mobile width (<768px): top bar + hamburger appear, sidebar hides

- [ ] **Step 4: Commit any fixes, then final commit**

```bash
git add -A
git commit -m "build: final smoke-test fixes for cases + delete + responsive"
```
