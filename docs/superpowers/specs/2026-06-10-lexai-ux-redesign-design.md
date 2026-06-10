# LexAI UX Redesign — Design Spec
**Date:** 2026-06-10  
**Status:** Approved

---

## Overview

Replace the flat top-nav shell with a fixed left sidebar, add an animated hero home page at `/`, move the Library to `/library`, and introduce a new Case Review workspace at `/review` that combines document pinning with AI-powered legal analysis tools.

---

## Routes

| Route | Component | Notes |
|---|---|---|
| `/` | `HomePage` | New — animated hero + upload CTAs |
| `/library` | `Library` | Existing page, moved from `/` |
| `/files/:id` | `DocumentView` | Unchanged |
| `/chat` | `ChatPage` | Unchanged |
| `/review` | `CaseReview` | New — case workspace + analysis |

---

## Layout Shell

**File:** `src/components/Sidebar.tsx` (new) + `App.tsx` refactor

Replace the current `<nav>` top bar with a fixed left sidebar (`w-60`, `bg-slate-900`). The sidebar contains:

1. **Logo** — "⚖️ LexAI v2" at top with indigo accent
2. **Nav links** (with icons) — Home, Library, Case Review, Chat
3. **Index status pill** at bottom — shows "● Idle", "⚡ Indexing N%" or "✓ N docs indexed" pulled from `/api/index/status` on mount

`App.tsx` wraps all routes in a flex container: `<Sidebar />` (fixed left) + `<main>` (ml-60, flex-1, p-6).

---

## Home Page (`/`)

**File:** `src/pages/Home.tsx` (new)

### Hero Section
Full-viewport (`min-h-screen`) dark gradient background: `from-slate-900 via-slate-900 to-indigo-950`.

**Animated elements (pure CSS / Tailwind, no JS animation libraries):**
- A blurred radial glow orb (`bg-indigo-600/20 blur-3xl`) with a slow `animate-pulse` behind the content
- Headline fades + slides up on mount via a CSS `@keyframes` animation defined in `index.css`
- Subheadline fades in with a short delay after the headline

**Content:**
- Headline: "Your Legal Documents, Intelligently Organized"
- Subheadline: "Ingest, search, and analyze case files with AI — entirely on your machine."
- Two primary CTA buttons side by side:
  - **Upload Files** — triggers a hidden `<input type="file" multiple accept=".pdf,.docx,.doc,.msg,.eml,.xlsx,.csv,.txt,.rtf">`. On change, calls `POST /api/upload` with a `FormData` body. Shows inline progress (uploading N/M).
  - **Add Folder** — calls existing `POST /api/pick-folder` → `POST /api/scan` flow. Shows scan progress inline below the buttons.
- A tertiary text link: "Browse Library →" navigating to `/library`

### Stats Strip
Below the hero, a three-card strip (fades in 600ms after hero):
- Total Documents (from `/api/files` count)
- Indexed Chunks (from `/api/index/status`)
- Failed Conversions (from `/api/files?status=failed` count)

Cards use `bg-white/5 backdrop-blur border border-white/10 rounded-xl` — glassmorphism style on the dark background.

---

## Library Page (`/library`)

**File:** `src/pages/Library.tsx` (existing, minor changes only)

- Route changes from `/` to `/library` in `App.tsx`
- Add a **"New Case →"** button next to "Add folder…" that navigates to `/review?ids=<selected>` when files are selected (same pattern as the existing Chat button)
- No other changes to Library logic

---

## Case Review Workspace (`/review`)

**File:** `src/pages/CaseReview.tsx` (new)

Three-column layout inside the main content area:

### Left Panel — Document Picker (`w-72 shrink-0`)
- **Case name** input at top (plain text, stored in local React state)
- Search input that filters files from `/api/files` by name
- Scrollable list of matching files; click to pin
- **Pinned documents** section below the search, listed with filename + a remove (×) button
- On mount, reads `?ids=` query param and pre-pins those document IDs (matches Library's "New Case →" flow)

### Center Panel — Document Reader (`flex-1 min-w-0`)
- Horizontal tab bar, one tab per pinned document (filename, truncated)
- Active tab shows the document's markdown content via `/api/files/:id` — reuses the existing markdown renderer (`<ReactMarkdown>`)
- Empty state: "Pin documents from the left panel to start reading"

### Right Panel — Analysis Tools (`w-80 shrink-0`)
Legal analysis presets (pill buttons):
1. Summarize
2. Parties & Dates
3. Obligations & Deadlines
4. **Risk Flags** *(new)* — "Identify clauses that pose legal risk or unusual obligations."
5. **Precedent Search** *(new)* — "Find references to case law, statutes, or precedents in these documents."

Custom prompt `<textarea>` below the presets.

**Run Analysis** button — disabled when no documents are pinned or prompt is empty. Calls existing `POST /api/analyses` with `{ file_ids: pinnedIds, prompt }`. Shows a loading state ("Analyzing…").

Result renders in a scrollable markdown block below the button.

**Analysis History accordion** at bottom — fetches `GET /api/analyses`, shows past analyses as collapsible `<details>` rows (same as current Analyze page).

---

## File Upload (new backend requirement)

The **Upload Files** button on the home page requires a new backend endpoint:

`POST /api/upload` — accepts `multipart/form-data` with one or more files. Backend saves each file to a temporary staging directory, then runs the existing ingest pipeline on it. Returns `{ job_id }` for progress polling (same shape as `/api/scan`).

This is the only new backend work required. All other API calls reuse existing endpoints.

---

## Animations

Defined in `src/index.css` using `@keyframes`:

```css
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

Applied via inline `style` props with `animationDelay` for staggered entrance. No external animation libraries.

---

## Component Breakdown

| File | Type | Purpose |
|---|---|---|
| `src/components/Sidebar.tsx` | New | Fixed sidebar with nav + status pill |
| `src/pages/Home.tsx` | New | Animated hero + upload + stats |
| `src/pages/CaseReview.tsx` | New | Three-column case workspace |
| `src/pages/Library.tsx` | Edit | Route change + "New Case" button |
| `src/App.tsx` | Edit | Sidebar layout, updated routes |
| `src/index.css` | Edit | Add `@keyframes fadeSlideUp` |
| `backend/app/main.py` | Edit | Add `POST /api/upload` endpoint |

---

## Out of Scope

- Case persistence (saving named cases to the database) — React state only for now
- Sidebar collapse / mobile responsiveness
- Auth / multi-user support
- Changes to Chat page
- Changes to Document viewer page
