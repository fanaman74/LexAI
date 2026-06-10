# LexAI Cases & File Deletion — Design Spec
**Date:** 2026-06-10  
**Status:** Approved

---

## Overview

Add three related features to LexAI:
1. **Delete files** — remove a file from the index (DB + embeddings), not from disk
2. **Cases** — persistent SQLite-backed case entities, files linked to cases many-to-many
3. **Upload with case assignment** — upload modal lets user pick an existing case or create a new one inline

Visual aesthetic for new UI: **dark/amber** — `bg-zinc-950` backgrounds, `amber-400` accents, `zinc-800` borders, white/zinc-300 text (matching impeccable.style: pure black, amber highlights, minimal whitespace).

---

## Database Schema Changes

Two new tables appended to the existing `SCHEMA` string in `backend/app/db.py`:

```sql
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

No migration required — `CREATE TABLE IF NOT EXISTS` is idempotent. Tables are added to the existing SCHEMA string so `init_db()` creates them on next startup for new and existing databases.

---

## Backend API

### New router: `backend/app/routers/cases.py`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/cases` | List all cases with `file_count` and `files` array |
| `POST` | `/api/cases` | Create case `{ name, description? }` → `{ id, name, … }` |
| `GET` | `/api/cases/{case_id}` | Single case detail with full file list |
| `POST` | `/api/cases/{case_id}/files` | Add files `{ file_ids: [int] }` to case |
| `DELETE` | `/api/cases/{case_id}/files/{file_id}` | Remove file from case (not deleted from index) |
| `DELETE` | `/api/cases/{case_id}` | Delete case (cascade removes `case_files` rows, not files) |

**GET /api/cases response shape:**
```json
{
  "cases": [
    {
      "id": 1,
      "name": "Smith v. Jones",
      "description": "",
      "created_at": "2026-06-10T12:00:00",
      "file_count": 3,
      "files": [
        { "id": 5, "original_name": "contract.pdf", "status": "converted", "has_markdown": true }
      ]
    }
  ]
}
```

### Modified: `backend/app/routers/files.py`

Add `DELETE /api/files/{file_id}` endpoint:
- Deletes row from `files` table (cascades to `file_locations`, `markdown_files`, `chunks`, `file_tags`, `notes`, `case_files`)
- Does **not** touch the filesystem
- Returns `{ "ok": true }`

### Modified: `backend/app/routers/upload.py`

Accept optional `case_id: int | None = Form(None)` alongside `files: list[UploadFile]`.

Pass `case_id` to `IngestJob` as a new attribute (`job.case_id = case_id`). Inside `IngestJob.run()`, after each file is saved to the DB, if `self.case_id` is set, insert a row into `case_files(case_id, file_id)`. This keeps linking atomic with ingestion — no frontend round-trip needed.

The upload endpoint continues to return `{ job_id }` unchanged. Frontend polls as before; case linking happens automatically in the background thread.

### Register new router in `backend/app/main.py`

```python
from .routers import cases
app.include_router(cases.router)
```

---

## Frontend

### New page: `frontend/src/pages/Cases.tsx`

Route: `/cases`

**Visual design:**
- Full page: `bg-zinc-950 min-h-screen text-white`
- Page header: "Cases" in white bold, + "New Case" button in amber (`bg-amber-500 hover:bg-amber-400 text-black font-semibold`)
- Cases table: `bg-zinc-900 border border-zinc-800 rounded-xl` container
- Table columns: **Name** | **Files** | **Created** | **Actions**
- Each row: `border-b border-zinc-800`, hover `bg-zinc-800/50`
- Expandable row: click row name → expands to show file list inline with links to `/files/:id`
- File list shows: filename, type badge, status dot, "MD" link if converted, "Original" link
- Actions column: trash icon button (red on hover) to delete case

**New Case inline form:**
- Clicking "+ New Case" shows an inline form at the top of the table (not a modal)
- Fields: Name (required), Description (optional)
- "Create" button (amber) + "Cancel" link
- On submit: `POST /api/cases` → row appears at top of list

### Modified: `frontend/src/pages/Library.tsx`

Add a trash icon button to each file row. On click:
- Show a small inline confirm: "Remove from index?" with Confirm/Cancel buttons
- On confirm: `DELETE /api/files/{id}` → remove row from local state (no re-fetch)

### Modified: `frontend/src/pages/Home.tsx` — Upload Case Modal

Replace the current `fileInputRef.current?.click()` direct trigger with a two-step flow:

1. "Upload Files" button opens a small modal overlay:
   - **Files section**: `<input type="file" multiple>` rendered visibly inside the modal
   - **Case (optional)**: searchable `<select>` populated from `GET /api/cases` + a "New case…" option at the bottom that reveals an inline text input for the case name
   - **Upload button** (amber): submits
   - **Cancel** link: closes modal

2. After upload completes (poll shows `done`): stats refresh as before. File-to-case linking is handled automatically by the backend — no additional frontend call needed.

**Modal design:**
- `fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50`
- Modal card: `bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-full max-w-md`
- Title: "Upload Files" in white, subtitle: "Optionally assign to a case" in zinc-400

### Modified: `frontend/src/components/Sidebar.tsx`

Add "Cases" nav link between Library and Case Review:
```tsx
<NavLink to="/cases" className={link}><span>📁</span> Cases</NavLink>
```

### Modified: `frontend/src/App.tsx`

Add route:
```tsx
import Cases from "./pages/Cases";
// ...
<Route path="/cases" element={<Cases />} />
```

---

## Type additions to `frontend/src/api.ts`

```ts
export interface Case {
  id: number;
  name: string;
  description: string;
  created_at: string;
  file_count: number;
  files: CaseFile[];
}

export interface CaseFile {
  id: number;
  original_name: string;
  status: string;
  has_markdown: boolean;
}
```

---

## Animations / UX Details

- New case row slides in with `fadeSlideUp` (already defined in `index.css`)
- Delete confirmation is inline (no separate modal), fades in below the row
- Upload modal uses existing `fadeSlideUp` on open

---

## Responsive Design

All new and modified pages must be fully responsive. Key breakpoints:

- **Mobile (< 768px):** Sidebar collapses to a bottom tab bar or hamburger menu. Single-column layout. Upload modal takes full viewport width.
- **Tablet (768px–1024px):** Sidebar stays visible but narrower (w-16 icon-only). Cases table scrolls horizontally if needed.
- **Desktop (≥ 1024px):** Full sidebar (w-60), all columns visible.

Existing pages (Library, CaseReview, Chat) also get mobile-safe treatment as part of this work:
- Sidebar: add hamburger toggle on mobile, overlay drawer
- CaseReview: stack three columns vertically on mobile
- Library: card list instead of table on mobile

Implementation: Tailwind responsive prefixes (`sm:`, `md:`, `lg:`) — no JS resize listeners.

---

## Out of Scope

- Renaming cases (can add later)
- Case status / metadata beyond name + description
- Assigning cases from CaseReview page (existing local-state flow unchanged)
- Bulk file delete
- Soft delete / recycle bin
