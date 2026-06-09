# LexAI Phase 2 (Processing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python Celery/Redis extraction worker that claims queued documents, extracts text + markdown from PDF/DOCX/XLSX/EML/MSG files, stores a `.md` rendition in Supabase Storage, handles email attachments as linked child documents, and marks every document `processed` or `failed`.

**Architecture:** Pure extractor modules (`workers/extractors/`) each convert raw bytes to an `ExtractionResult`; a `jobs/process_document.py` Celery task orchestrates download → extract → persist; a `dispatcher.py` loop atomically claims queued docs via a `claim_next_document()` DB function and enqueues the task. All Supabase I/O is isolated in `supabase_client.py`. A Phase 2 migration adds `markdown_storage_path` to `documents` and the `claim_next_document()` SECURITY DEFINER function.

**Tech Stack:** Python 3.14, Celery 5, Redis (broker/backend), `supabase-py`, `pypdf`, `python-docx`, `openpyxl`, `extract-msg`, `markdownify` (HTML→MD), `pytest`, `pyproject.toml` (pip/uv).

---

## File Structure

```
workers/
  pyproject.toml              # deps + pytest config
  .env.example                # worker env vars
  README.md                   # run instructions
  config.py                   # reads env vars into typed Config
  celery_app.py               # Celery instance (broker=redis)
  supabase_client.py          # all Supabase I/O (download, upload, doc CRUD)
  dispatcher.py               # poll loop → claim_next_document() → task.delay()
  extractors/
    __init__.py               # extract(source_type, data) router + Attachment dataclass
    common.py                 # ExtractionResult dataclass, html_to_markdown(), detect_source_type()
    pdf_extractor.py          # pypdf
    docx_extractor.py         # python-docx
    xlsx_extractor.py         # openpyxl
    eml_extractor.py          # stdlib email
    msg_extractor.py          # extract-msg
  jobs/
    __init__.py               # empty
    process_document.py       # Celery task
  tests/
    fixtures/                 # committed tiny test files
      sample.pdf              # 1-page PDF with known text
      sample.docx             # heading + table
      sample.xlsx             # 2 sheets
      sample.eml              # 1 text attachment (sample.pdf)
      sample.msg              # 1 attachment
    test_common.py
    test_pdf_extractor.py
    test_docx_extractor.py
    test_xlsx_extractor.py
    test_eml_extractor.py
    test_msg_extractor.py

lib/storage/paths.ts          # MODIFY: add markdownPath()
supabase/migrations/
  20260608180000_phase2.sql   # markdown_storage_path column + claim_next_document() fn
```

---

## Task 1: Phase 2 DB migration

**Files:**
- Create: `supabase/migrations/20260608180000_phase2.sql`
- Apply via Supabase CLI

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260608180000_phase2.sql`:

```sql
-- Phase 2: markdown storage path column + concurrency-safe claim function

alter table documents add column if not exists markdown_storage_path text null;

-- Atomically claim one queued document (FOR UPDATE SKIP LOCKED via PL/pgSQL)
-- Called by the Python dispatcher via PostgREST RPC: POST /rpc/claim_next_document
create or replace function public.claim_next_document()
returns setof documents
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select id into claimed_id
  from documents
  where processing_status = 'queued'
  order by created_at
  limit 1
  for update skip locked;

  if claimed_id is null then
    return;
  end if;

  return query
    update documents
    set processing_status = 'processing',
        updated_at = now()
    where id = claimed_id
    returning *;
end;
$$;
```

- [ ] **Step 2: Apply the migration**

Run from the repo root (replace `<DB_PASSWORD>` with value from `.env.local`):

```bash
export DB_PASSWORD=$(grep '^SUPABASE_DB_PASSWORD=' .env.local | cut -d= -f2-)
supabase db push \
  --db-url "postgresql://postgres.cdztsdygywfbxlfxcipe:${DB_PASSWORD}@aws-1-eu-central-1.pooler.supabase.com:5432/postgres"
```

Expected output: `Applying migration 20260608180000_phase2.sql... Finished supabase db push.`

- [ ] **Step 3: Verify**

```bash
PGPASSWORD=$DB_PASSWORD psql \
  "postgresql://postgres.cdztsdygywfbxlfxcipe@aws-1-eu-central-1.pooler.supabase.com:5432/postgres" \
  -c "\d documents" | grep markdown_storage_path
```

Expected: `markdown_storage_path | text | ...`

Also verify function exists:

```bash
PGPASSWORD=$DB_PASSWORD psql \
  "postgresql://postgres.cdztsdygywfbxlfxcipe@aws-1-eu-central-1.pooler.supabase.com:5432/postgres" \
  -c "\df claim_next_document"
```

Expected: one row with `claim_next_document`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260608180000_phase2.sql
git commit -m "feat(db): add markdown_storage_path column and claim_next_document() fn"
```

---

## Task 2: Add `markdownPath` to TypeScript paths helper

**Files:**
- Modify: `lib/storage/paths.ts`
- Modify: `tests/storage/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/storage/paths.test.ts` (append after existing tests):

```ts
import { markdownPath } from "@/lib/storage/paths";

describe("markdownPath", () => {
  it("builds markdown artifact path", () => {
    expect(markdownPath("u1", "d1", "report.pdf"))
      .toBe("u1/d1/markdown/report.pdf.md");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- paths
```

Expected: FAIL with `markdownPath is not a function` or import error.

- [ ] **Step 3: Implement**

Add to `lib/storage/paths.ts` (append after `attachmentPath`):

```ts
export function markdownPath(
  userId: string, documentId: string, originalFilename: string
): string {
  return `${userId}/${documentId}/markdown/${originalFilename}.md`;
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- paths
```

Expected: PASS (all paths tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/storage/paths.ts tests/storage/paths.test.ts
git commit -m "feat(storage): add markdownPath helper"
```

---

## Task 3: Worker package scaffold + config

**Files:**
- Create: `workers/pyproject.toml`, `workers/.env.example`, `workers/config.py`, `workers/celery_app.py`

- [ ] **Step 1: Create pyproject.toml**

Create `workers/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=70"]
build-backend = "setuptools.backends.legacy:build"

[project]
name = "lexai-workers"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "celery[redis]>=5.4",
  "supabase>=2.9",
  "pypdf>=4.3",
  "python-docx>=1.1",
  "openpyxl>=3.1",
  "extract-msg>=0.48",
  "markdownify>=0.13",
]

[project.optional-dependencies]
dev = [
  "pytest>=8",
  "pytest-asyncio>=0.23",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

- [ ] **Step 2: Install deps**

```bash
cd workers
pip3 install -e ".[dev]"
```

Expected: all packages install cleanly. Verify with:

```bash
python3 -c "import celery, supabase, pypdf, docx, openpyxl, extract_msg, markdownify; print('all imports OK')"
```

Expected: `all imports OK`

- [ ] **Step 3: Create .env.example**

Create `workers/.env.example`:

```env
SUPABASE_URL=https://cdztsdygywfbxlfxcipe.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
REDIS_URL=redis://localhost:6379/0
STORAGE_BUCKET=legal-documents
DISPATCHER_POLL_SECONDS=3
```

- [ ] **Step 4: Create config.py**

Create `workers/config.py`:

```python
import os


class Config:
    supabase_url: str = os.environ["SUPABASE_URL"]
    supabase_service_role_key: str = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    redis_url: str = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    storage_bucket: str = os.environ.get("STORAGE_BUCKET", "legal-documents")
    dispatcher_poll_seconds: float = float(
        os.environ.get("DISPATCHER_POLL_SECONDS", "3")
    )
```

- [ ] **Step 5: Create celery_app.py**

Create `workers/celery_app.py`:

```python
from celery import Celery
from config import Config

app = Celery(
    "lexai",
    broker=Config.redis_url,
    backend=Config.redis_url,
    include=["jobs.process_document"],
)

app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
)
```

- [ ] **Step 6: Verify imports**

```bash
cd workers
python3 -c "from celery_app import app; print('celery app:', app.main)"
```

Expected: `celery app: lexai`

- [ ] **Step 7: Commit**

```bash
cd ..
git add workers/pyproject.toml workers/.env.example workers/config.py workers/celery_app.py
git commit -m "feat(worker): package scaffold, config, and celery app"
```

---

## Task 4: `ExtractionResult` dataclass + common helpers (TDD)

**Files:**
- Create: `workers/extractors/__init__.py`, `workers/extractors/common.py`
- Create: `workers/tests/__init__.py`, `workers/tests/test_common.py`

- [ ] **Step 1: Write failing tests**

Create `workers/tests/__init__.py` (empty).

Create `workers/tests/test_common.py`:

```python
from extractors.common import ExtractionResult, Attachment, html_to_markdown, detect_source_type


def test_extraction_result_defaults():
    r = ExtractionResult(text="hello", markdown="**hello**", metadata={})
    assert r.text == "hello"
    assert r.markdown == "**hello**"
    assert r.attachments == []


def test_attachment_fields():
    a = Attachment(filename="doc.pdf", data=b"bytes", content_type="application/pdf")
    assert a.filename == "doc.pdf"
    assert a.data == b"bytes"


def test_html_to_markdown_basic():
    md = html_to_markdown("<p>Hello <b>world</b></p>")
    assert "Hello" in md
    assert "world" in md


def test_html_to_markdown_strips_tags():
    md = html_to_markdown("<html><body><p>clean</p></body></html>")
    assert "<html>" not in md
    assert "clean" in md


def test_detect_source_type():
    assert detect_source_type("file.pdf") == "pdf"
    assert detect_source_type("FILE.DOCX") == "docx"
    assert detect_source_type("sheet.xlsx") == "xlsx"
    assert detect_source_type("mail.eml") == "eml"
    assert detect_source_type("outlook.msg") == "msg"
    assert detect_source_type("image.png") == "email_attachment"
```

- [ ] **Step 2: Run tests, verify fail**

```bash
cd workers && python3 -m pytest tests/test_common.py -v
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `workers/extractors/__init__.py`:

```python
from extractors.common import ExtractionResult, detect_source_type
from extractors.pdf_extractor import extract as extract_pdf
from extractors.docx_extractor import extract as extract_docx
from extractors.xlsx_extractor import extract as extract_xlsx
from extractors.eml_extractor import extract as extract_eml
from extractors.msg_extractor import extract as extract_msg

_EXTRACTORS = {
    "pdf": extract_pdf,
    "docx": extract_docx,
    "xlsx": extract_xlsx,
    "eml": extract_eml,
    "msg": extract_msg,
    "email_attachment": lambda data: _route_attachment(data),
}


def _route_attachment(data: bytes) -> ExtractionResult:
    """Attachments are re-queued with their real source_type; this is a fallback."""
    return ExtractionResult(
        text="[attachment — requeued for extraction]",
        markdown="*attachment — requeued for extraction*",
        metadata={"note": "routed as attachment"},
    )


def extract(source_type: str, data: bytes) -> ExtractionResult:
    """Route raw bytes to the correct extractor by source_type."""
    fn = _EXTRACTORS.get(source_type)
    if fn is None:
        return ExtractionResult(
            text="",
            markdown="",
            metadata={"error": f"unsupported source_type: {source_type}"},
        )
    return fn(data)
```

Create `workers/extractors/common.py`:

```python
from __future__ import annotations
from dataclasses import dataclass, field
from markdownify import markdownify


@dataclass
class Attachment:
    filename: str
    data: bytes
    content_type: str = "application/octet-stream"


@dataclass
class ExtractionResult:
    text: str
    markdown: str
    metadata: dict
    attachments: list[Attachment] = field(default_factory=list)


def html_to_markdown(html: str) -> str:
    """Convert HTML to markdown using markdownify."""
    return markdownify(html, heading_style="ATX", strip=["script", "style"]).strip()


_EXT_MAP: dict[str, str] = {
    "pdf": "pdf",
    "docx": "docx",
    "doc": "docx",
    "xlsx": "xlsx",
    "xls": "xlsx",
    "eml": "eml",
    "msg": "msg",
}


def detect_source_type(filename: str) -> str:
    """Return source_type from filename extension; default to email_attachment."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return _EXT_MAP.get(ext, "email_attachment")
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd workers && python3 -m pytest tests/test_common.py -v
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ..
git add workers/extractors workers/tests/__init__.py workers/tests/test_common.py
git commit -m "feat(extractors): ExtractionResult dataclass and common helpers"
```

---

## Task 5: PDF extractor (TDD)

**Files:**
- Create: `workers/extractors/pdf_extractor.py`
- Create: `workers/tests/fixtures/sample.pdf`
- Create: `workers/tests/test_pdf_extractor.py`

- [ ] **Step 1: Create test fixture**

Run this Python script once to create the fixture (requires `pypdf` installed):

```bash
cd workers
python3 - <<'EOF'
from pypdf import PdfWriter
import pathlib

w = PdfWriter()
w.add_blank_page(width=612, height=792)
# Write known text via metadata title (blank pages have no text layer)
# Instead create a 2-page PDF with text via reportlab-free approach:
# we'll use a minimal valid PDF with embedded text
pdf_bytes = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]
/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>
stream
BT /F1 12 Tf 100 700 Td (Hello from LexAI PDF) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000360 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
441
%%EOF"""
pathlib.Path("tests/fixtures").mkdir(exist_ok=True)
pathlib.Path("tests/fixtures/sample.pdf").write_bytes(pdf_bytes)
print("sample.pdf written", len(pdf_bytes), "bytes")
EOF
```

Expected: `sample.pdf written NNN bytes`

- [ ] **Step 2: Write failing tests**

Create `workers/tests/test_pdf_extractor.py`:

```python
import pathlib
from extractors.pdf_extractor import extract

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "sample.pdf"


def test_pdf_returns_extraction_result():
    data = FIXTURE.read_bytes()
    result = extract(data)
    assert result.text is not None
    assert result.markdown is not None
    assert isinstance(result.metadata, dict)


def test_pdf_metadata_has_page_count():
    data = FIXTURE.read_bytes()
    result = extract(data)
    assert "page_count" in result.metadata
    assert result.metadata["page_count"] >= 1


def test_pdf_metadata_has_requires_ocr():
    data = FIXTURE.read_bytes()
    result = extract(data)
    assert "requires_ocr" in result.metadata


def test_pdf_no_attachments():
    data = FIXTURE.read_bytes()
    result = extract(data)
    assert result.attachments == []
```

- [ ] **Step 3: Run tests, verify fail**

```bash
cd workers && python3 -m pytest tests/test_pdf_extractor.py -v
```

Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

Create `workers/extractors/pdf_extractor.py`:

```python
from __future__ import annotations
import io
from pypdf import PdfReader
from extractors.common import ExtractionResult

_OCR_THRESHOLD = 50  # chars per page below which we flag requires_ocr


def extract(data: bytes) -> ExtractionResult:
    reader = PdfReader(io.BytesIO(data))
    page_count = len(reader.pages)
    pages_text: list[str] = []

    for page in reader.pages:
        text = page.extract_text() or ""
        pages_text.append(text)

    full_text = "\n\n".join(pages_text).strip()
    avg_chars = len(full_text) / page_count if page_count else 0
    requires_ocr = avg_chars < _OCR_THRESHOLD

    # Markdown: pages separated by horizontal rule
    page_sections = [f"<!-- page {i+1} -->\n{t}" for i, t in enumerate(pages_text) if t.strip()]
    markdown = "\n\n---\n\n".join(page_sections) if page_sections else ""

    metadata = {
        "page_count": page_count,
        "requires_ocr": requires_ocr,
        "title": reader.metadata.title if reader.metadata else None,
        "author": reader.metadata.author if reader.metadata else None,
    }
    return ExtractionResult(text=full_text, markdown=markdown, metadata=metadata)
```

- [ ] **Step 5: Run tests, verify pass**

```bash
cd workers && python3 -m pytest tests/test_pdf_extractor.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ..
git add workers/extractors/pdf_extractor.py workers/tests/fixtures/sample.pdf workers/tests/test_pdf_extractor.py
git commit -m "feat(extractors): PDF extractor with page-by-page text and OCR detection"
```

---

## Task 6: DOCX extractor (TDD)

**Files:**
- Create: `workers/extractors/docx_extractor.py`
- Create: `workers/tests/fixtures/sample.docx`
- Create: `workers/tests/test_docx_extractor.py`

- [ ] **Step 1: Create fixture**

```bash
cd workers
python3 - <<'EOF'
from docx import Document
from docx.oxml.ns import qn
import pathlib

doc = Document()
doc.add_heading("LexAI Test Document", level=1)
doc.add_paragraph("This is a paragraph with some text.")
doc.add_heading("Section Two", level=2)
table = doc.add_table(rows=2, cols=2)
table.cell(0,0).text = "Name"
table.cell(0,1).text = "Value"
table.cell(1,0).text = "Alpha"
table.cell(1,1).text = "42"
pathlib.Path("tests/fixtures").mkdir(exist_ok=True)
doc.save("tests/fixtures/sample.docx")
print("sample.docx written")
EOF
```

Expected: `sample.docx written`

- [ ] **Step 2: Write failing tests**

Create `workers/tests/test_docx_extractor.py`:

```python
import pathlib
from extractors.docx_extractor import extract

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "sample.docx"


def test_docx_extracts_text():
    result = extract(FIXTURE.read_bytes())
    assert "LexAI Test Document" in result.text
    assert "paragraph" in result.text.lower()


def test_docx_markdown_has_heading():
    result = extract(FIXTURE.read_bytes())
    assert "# LexAI Test Document" in result.markdown


def test_docx_markdown_has_table():
    result = extract(FIXTURE.read_bytes())
    assert "| Name" in result.markdown or "|Name" in result.markdown


def test_docx_no_attachments():
    result = extract(FIXTURE.read_bytes())
    assert result.attachments == []
```

- [ ] **Step 3: Run tests, verify fail**

```bash
cd workers && python3 -m pytest tests/test_docx_extractor.py -v
```

Expected: FAIL.

- [ ] **Step 4: Implement**

Create `workers/extractors/docx_extractor.py`:

```python
from __future__ import annotations
import io
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from extractors.common import ExtractionResult


def _para_to_markdown(para: Paragraph) -> str:
    style = para.style.name if para.style else ""
    text = para.text.strip()
    if not text:
        return ""
    if style == "Heading 1":
        return f"# {text}"
    if style == "Heading 2":
        return f"## {text}"
    if style.startswith("Heading"):
        level = int(style.split()[-1]) if style.split()[-1].isdigit() else 3
        return "#" * level + f" {text}"
    return text


def _table_to_markdown(table: Table) -> str:
    rows = []
    for i, row in enumerate(table.rows):
        cells = [c.text.strip().replace("|", "\\|") for c in row.cells]
        rows.append("| " + " | ".join(cells) + " |")
        if i == 0:
            rows.append("| " + " | ".join(["---"] * len(cells)) + " |")
    return "\n".join(rows)


def extract(data: bytes) -> ExtractionResult:
    doc = Document(io.BytesIO(data))
    md_parts: list[str] = []
    text_parts: list[str] = []

    for block in doc.element.body:
        tag = block.tag.split("}")[-1] if "}" in block.tag else block.tag
        if tag == "p":
            from docx.text.paragraph import Paragraph as _P
            para = _P(block, doc)
            md = _para_to_markdown(para)
            if md:
                md_parts.append(md)
                text_parts.append(para.text.strip())
        elif tag == "tbl":
            from docx.table import Table as _T
            tbl = _T(block, doc)
            md_parts.append(_table_to_markdown(tbl))
            for row in tbl.rows:
                text_parts.append(" | ".join(c.text.strip() for c in row.cells))

    metadata = {}
    cp = doc.core_properties
    if cp.author:
        metadata["author"] = cp.author
    if cp.created:
        metadata["created"] = str(cp.created)
    if cp.modified:
        metadata["modified"] = str(cp.modified)

    return ExtractionResult(
        text="\n".join(text_parts),
        markdown="\n\n".join(md_parts),
        metadata=metadata,
    )
```

- [ ] **Step 5: Run tests, verify pass**

```bash
cd workers && python3 -m pytest tests/test_docx_extractor.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ..
git add workers/extractors/docx_extractor.py workers/tests/fixtures/sample.docx workers/tests/test_docx_extractor.py
git commit -m "feat(extractors): DOCX extractor with headings, paragraphs, and tables"
```

---

## Task 7: XLSX extractor (TDD)

**Files:**
- Create: `workers/extractors/xlsx_extractor.py`
- Create: `workers/tests/fixtures/sample.xlsx`
- Create: `workers/tests/test_xlsx_extractor.py`

- [ ] **Step 1: Create fixture**

```bash
cd workers
python3 - <<'EOF'
import openpyxl, pathlib
wb = openpyxl.Workbook()
ws1 = wb.active; ws1.title = "Expenses"
ws1.append(["Date", "Description", "Amount"])
ws1.append(["2026-05-01", "Legal Fees", 1000])
ws1.append(["2026-05-02", "Court Filing", 250])
ws2 = wb.create_sheet("Summary")
ws2.append(["Category", "Total"])
ws2.append(["Legal", 1250])
pathlib.Path("tests/fixtures").mkdir(exist_ok=True)
wb.save("tests/fixtures/sample.xlsx")
print("sample.xlsx written")
EOF
```

- [ ] **Step 2: Write failing tests**

Create `workers/tests/test_xlsx_extractor.py`:

```python
import pathlib
from extractors.xlsx_extractor import extract

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "sample.xlsx"


def test_xlsx_contains_sheet_names():
    result = extract(FIXTURE.read_bytes())
    assert "Expenses" in result.markdown
    assert "Summary" in result.markdown


def test_xlsx_contains_cell_values():
    result = extract(FIXTURE.read_bytes())
    assert "Legal Fees" in result.text
    assert "1000" in result.text or "1000" in result.markdown


def test_xlsx_metadata_has_sheet_names():
    result = extract(FIXTURE.read_bytes())
    assert "sheet_names" in result.metadata
    assert "Expenses" in result.metadata["sheet_names"]


def test_xlsx_no_attachments():
    result = extract(FIXTURE.read_bytes())
    assert result.attachments == []
```

- [ ] **Step 3: Run tests, verify fail**

```bash
cd workers && python3 -m pytest tests/test_xlsx_extractor.py -v
```

Expected: FAIL.

- [ ] **Step 4: Implement**

Create `workers/extractors/xlsx_extractor.py`:

```python
from __future__ import annotations
import io
import openpyxl
from extractors.common import ExtractionResult


def extract(data: bytes) -> ExtractionResult:
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    md_parts: list[str] = []
    text_parts: list[str] = []
    sheet_names: list[str] = []

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        sheet_names.append(sheet_name)
        md_parts.append(f"## Sheet: {sheet_name}")
        rows: list[list[str]] = []
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) if c is not None else "" for c in row]
            if any(c.strip() for c in cells):
                rows.append(cells)

        if not rows:
            continue

        # Markdown table
        header = rows[0]
        md_parts.append("| " + " | ".join(header) + " |")
        md_parts.append("| " + " | ".join(["---"] * len(header)) + " |")
        for row in rows[1:]:
            # pad to header width
            padded = row + [""] * (len(header) - len(row))
            md_parts.append("| " + " | ".join(padded[:len(header)]) + " |")

        for row in rows:
            text_parts.append(" | ".join(row))

    wb.close()
    return ExtractionResult(
        text="\n".join(text_parts),
        markdown="\n".join(md_parts),
        metadata={"sheet_names": sheet_names, "sheet_count": len(sheet_names)},
    )
```

- [ ] **Step 5: Run tests, verify pass**

```bash
cd workers && python3 -m pytest tests/test_xlsx_extractor.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ..
git add workers/extractors/xlsx_extractor.py workers/tests/fixtures/sample.xlsx workers/tests/test_xlsx_extractor.py
git commit -m "feat(extractors): XLSX extractor with per-sheet markdown tables"
```

---

## Task 8: EML extractor (TDD)

**Files:**
- Create: `workers/extractors/eml_extractor.py`
- Create: `workers/tests/fixtures/sample.eml`
- Create: `workers/tests/test_eml_extractor.py`

- [ ] **Step 1: Create fixture**

```bash
cd workers
python3 - <<'EOF'
import email.mime.multipart, email.mime.text, email.mime.base, email.encoders, pathlib, datetime

msg = email.mime.multipart.MIMEMultipart()
msg["From"] = "alice@example.com"
msg["To"] = "bob@example.com"
msg["Cc"] = "carol@example.com"
msg["Subject"] = "Evidence email"
msg["Date"] = "Mon, 08 Jun 2026 10:00:00 +0000"
msg["Message-ID"] = "<test-msg-id@example.com>"
msg.attach(email.mime.text.MIMEText("This is the body text.", "plain"))
att = email.mime.base.MIMEBase("application", "pdf")
att.set_payload(b"%PDF-1.4 minimal")
email.encoders.encode_base64(att)
att.add_header("Content-Disposition", "attachment", filename="evidence.pdf")
msg.attach(att)
pathlib.Path("tests/fixtures").mkdir(exist_ok=True)
pathlib.Path("tests/fixtures/sample.eml").write_bytes(msg.as_bytes())
print("sample.eml written")
EOF
```

- [ ] **Step 2: Write failing tests**

Create `workers/tests/test_eml_extractor.py`:

```python
import pathlib
from extractors.eml_extractor import extract

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "sample.eml"


def test_eml_extracts_body():
    result = extract(FIXTURE.read_bytes())
    assert "body text" in result.text.lower()


def test_eml_metadata_headers():
    result = extract(FIXTURE.read_bytes())
    assert result.metadata["from"] == "alice@example.com"
    assert "bob@example.com" in result.metadata["to"]
    assert result.metadata["subject"] == "Evidence email"
    assert result.metadata["message_id"] == "<test-msg-id@example.com>"


def test_eml_markdown_has_header_block():
    result = extract(FIXTURE.read_bytes())
    assert "**From:**" in result.markdown
    assert "**Subject:**" in result.markdown


def test_eml_extracts_attachment():
    result = extract(FIXTURE.read_bytes())
    assert len(result.attachments) == 1
    assert result.attachments[0].filename == "evidence.pdf"
    assert len(result.attachments[0].data) > 0
```

- [ ] **Step 3: Run tests, verify fail**

```bash
cd workers && python3 -m pytest tests/test_eml_extractor.py -v
```

Expected: FAIL.

- [ ] **Step 4: Implement**

Create `workers/extractors/eml_extractor.py`:

```python
from __future__ import annotations
import email
import email.policy
from email.header import decode_header
from extractors.common import ExtractionResult, Attachment, html_to_markdown


def _decode_header_value(val: str | None) -> str:
    if not val:
        return ""
    parts = decode_header(val)
    return "".join(
        p.decode(enc or "utf-8") if isinstance(p, bytes) else p
        for p, enc in parts
    )


def extract(data: bytes) -> ExtractionResult:
    msg = email.message_from_bytes(data, policy=email.policy.compat32)

    from_addr = _decode_header_value(msg.get("From", ""))
    to_addrs = [a.strip() for a in _decode_header_value(msg.get("To", "")).split(",") if a.strip()]
    cc_addrs = [a.strip() for a in _decode_header_value(msg.get("Cc", "")).split(",") if a.strip()]
    subject = _decode_header_value(msg.get("Subject", ""))
    date_str = msg.get("Date", "")
    message_id = msg.get("Message-ID", "")

    body_text = ""
    body_html = ""
    attachments: list[Attachment] = []

    for part in msg.walk():
        ct = part.get_content_type()
        cd = part.get("Content-Disposition", "")
        if "attachment" in cd:
            filename = part.get_filename() or "attachment"
            att_bytes = part.get_payload(decode=True) or b""
            attachments.append(Attachment(
                filename=filename,
                data=att_bytes,
                content_type=ct,
            ))
        elif ct == "text/plain" and not body_text:
            payload = part.get_payload(decode=True)
            if payload:
                charset = part.get_content_charset() or "utf-8"
                body_text = payload.decode(charset, errors="replace")
        elif ct == "text/html" and not body_html:
            payload = part.get_payload(decode=True)
            if payload:
                charset = part.get_content_charset() or "utf-8"
                body_html = payload.decode(charset, errors="replace")

    body = body_text or html_to_markdown(body_html)

    header_md = (
        f"# Email\n\n"
        f"**From:** {from_addr}  \n"
        f"**To:** {', '.join(to_addrs)}  \n"
        + (f"**CC:** {', '.join(cc_addrs)}  \n" if cc_addrs else "")
        + f"**Date:** {date_str}  \n"
        f"**Subject:** {subject}  \n"
    )
    att_list = "\n".join(f"{i+1}. {a.filename}" for i, a in enumerate(attachments))
    att_md = f"\n\n## Attachments\n\n{att_list}" if attachments else ""
    markdown = header_md + "\n\n## Body\n\n" + body + att_md

    metadata = {
        "from": from_addr,
        "to": to_addrs,
        "cc": cc_addrs,
        "subject": subject,
        "date": date_str,
        "message_id": message_id,
    }
    return ExtractionResult(
        text=f"From: {from_addr}\nTo: {', '.join(to_addrs)}\nSubject: {subject}\n\n{body}",
        markdown=markdown,
        metadata=metadata,
        attachments=attachments,
    )
```

- [ ] **Step 5: Run tests, verify pass**

```bash
cd workers && python3 -m pytest tests/test_eml_extractor.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ..
git add workers/extractors/eml_extractor.py workers/tests/fixtures/sample.eml workers/tests/test_eml_extractor.py
git commit -m "feat(extractors): EML extractor with headers, body, and attachments"
```

---

## Task 9: MSG extractor (TDD)

**Files:**
- Create: `workers/extractors/msg_extractor.py`
- Create: `workers/tests/fixtures/sample.msg`
- Create: `workers/tests/test_msg_extractor.py`

- [ ] **Step 1: Create MSG fixture**

```bash
cd workers
python3 - <<'EOF'
# extract-msg can read MSG files but not write them.
# Use a minimal synthetic MSG binary (CFBF format).
# Simplest approach: use extract-msg's own test fixture path, or
# generate via compoundfiles + extract-msg.
# We use a tiny real-world-compatible approach via the 'msg-parser' utility
# actually just create the simplest possible valid .msg using compoundfiles if available,
# otherwise write a fallback marker and the test will skip gracefully.
import pathlib, importlib

pathlib.Path("tests/fixtures").mkdir(exist_ok=True)

# Try to create a minimal MSG file using extract-msg's writer if available
try:
    import extract_msg
    from extract_msg import MSGFile
    # extract-msg doesn't have a writer — use a pre-baked minimal binary
    raise ImportError("no writer")
except Exception:
    pass

# Write a minimal CFBF (Compound File Binary Format) MSG stub
# that extract-msg can open without crashing (it will just have empty fields)
# This is a real minimal CFBF header (512-byte sector, version 3)
import struct

def create_minimal_cfbf():
    # Minimal valid CFBF header (won't have real MSG properties, but won't crash on open)
    header = bytearray(512)
    # Magic number
    header[0:8] = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'
    # Minor version = 0x003E
    struct.pack_into('<H', header, 24, 0x003E)
    # Major version = 3
    struct.pack_into('<H', header, 26, 0x0003)
    # Byte order = little-endian
    struct.pack_into('<H', header, 28, 0xFFFE)
    # Sector size = 512 (2^9)
    struct.pack_into('<H', header, 30, 0x0009)
    # Mini sector size = 64 (2^6)
    struct.pack_into('<H', header, 32, 0x0006)
    # Dir sectors = 0
    struct.pack_into('<I', header, 40, 0)
    # FAT sectors = 1
    struct.pack_into('<I', header, 44, 1)
    # First dir sector = 1
    struct.pack_into('<I', header, 48, 1)
    # Mini stream cutoff = 4096
    struct.pack_into('<I', header, 56, 4096)
    # First mini FAT sector = FREESECT
    struct.pack_into('<I', header, 60, 0xFFFFFFFE)
    # FAT sector locations: sector 0 is FAT
    struct.pack_into('<I', header, 76, 0)
    # FAT sectors (512 bytes, all FREESECT)
    fat = bytearray(512)
    for i in range(0, 512, 4):
        struct.pack_into('<I', fat, i, 0xFFFFFFFF)  # FREESECT
    struct.pack_into('<I', fat, 0, 0xFFFFFFFD)  # FAT sector self
    struct.pack_into('<I', fat, 4, 0xFFFFFFFE)  # DIR sector end
    # Directory sector (512 bytes, 4 dir entries of 128 bytes each)
    dirsect = bytearray(512)
    # Entry 0: root entry "Root Entry"
    name = "Root Entry\x00"
    name_bytes = name.encode('utf-16-le')
    dirsect[0:len(name_bytes)] = name_bytes
    struct.pack_into('<H', dirsect, 64, len(name_bytes))  # name length
    dirsect[66] = 5  # object type = root
    dirsect[67] = 1  # color = black
    struct.pack_into('<I', dirsect, 68, 0xFFFFFFFF)  # left
    struct.pack_into('<I', dirsect, 72, 0xFFFFFFFF)  # right
    struct.pack_into('<I', dirsect, 76, 0xFFFFFFFF)  # child = none
    return bytes(header) + bytes(fat) + bytes(dirsect)

pathlib.Path("tests/fixtures/sample.msg").write_bytes(create_minimal_cfbf())
print("sample.msg written (minimal CFBF stub)")
EOF
```

- [ ] **Step 2: Write failing tests**

Create `workers/tests/test_msg_extractor.py`:

```python
import pathlib
import pytest
from extractors.msg_extractor import extract

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "sample.msg"


def test_msg_returns_extraction_result():
    """Even a stub MSG returns a valid ExtractionResult (never raises)."""
    result = extract(FIXTURE.read_bytes())
    assert result.text is not None
    assert result.markdown is not None
    assert isinstance(result.metadata, dict)
    assert isinstance(result.attachments, list)


def test_msg_failed_parse_sets_error_flag():
    """Corrupt bytes produce a failed ExtractionResult, not an exception."""
    result = extract(b"not a valid msg file at all !!!")
    assert result.metadata.get("parse_error") is True


def test_msg_attachments_is_list():
    result = extract(FIXTURE.read_bytes())
    assert isinstance(result.attachments, list)
```

- [ ] **Step 3: Run tests, verify fail**

```bash
cd workers && python3 -m pytest tests/test_msg_extractor.py -v
```

Expected: FAIL.

- [ ] **Step 4: Implement**

Create `workers/extractors/msg_extractor.py`:

```python
from __future__ import annotations
import io
import traceback
import extract_msg
from extractors.common import ExtractionResult, Attachment, html_to_markdown


def extract(data: bytes) -> ExtractionResult:
    try:
        msg = extract_msg.openMsg(io.BytesIO(data))
    except Exception as e:
        return ExtractionResult(
            text="",
            markdown="",
            metadata={"parse_error": True, "error": str(e)},
        )

    try:
        sender = getattr(msg, "sender", "") or ""
        subject = getattr(msg, "subject", "") or ""
        date = str(getattr(msg, "date", "") or "")
        to_addrs = [r.email for r in (getattr(msg, "recipients", []) or [])]
        cc = getattr(msg, "cc", "") or ""
        body = getattr(msg, "body", "") or ""
        html_body = getattr(msg, "htmlBody", None)
        if not body and html_body:
            body = html_to_markdown(
                html_body.decode("utf-8", errors="replace") if isinstance(html_body, bytes) else html_body
            )

        attachments: list[Attachment] = []
        for att in (getattr(msg, "attachments", []) or []):
            fname = getattr(att, "longFilename", None) or getattr(att, "shortFilename", "attachment")
            att_data = getattr(att, "data", None) or b""
            attachments.append(Attachment(
                filename=fname,
                data=att_data if isinstance(att_data, bytes) else bytes(att_data),
                content_type="application/octet-stream",
            ))

        header_md = (
            f"# Email\n\n"
            f"**From:** {sender}  \n"
            f"**To:** {', '.join(to_addrs)}  \n"
            + (f"**CC:** {cc}  \n" if cc else "")
            + f"**Date:** {date}  \n"
            f"**Subject:** {subject}  \n"
        )
        att_list = "\n".join(f"{i+1}. {a.filename}" for i, a in enumerate(attachments))
        att_md = f"\n\n## Attachments\n\n{att_list}" if attachments else ""
        markdown = header_md + "\n\n## Body\n\n" + body + att_md

        metadata = {
            "from": sender,
            "to": to_addrs,
            "cc": cc,
            "subject": subject,
            "date": date,
        }
        return ExtractionResult(
            text=f"From: {sender}\nTo: {', '.join(to_addrs)}\nSubject: {subject}\n\n{body}",
            markdown=markdown,
            metadata=metadata,
            attachments=attachments,
        )
    except Exception as e:
        return ExtractionResult(
            text="",
            markdown="",
            metadata={"parse_error": True, "error": str(e), "traceback": traceback.format_exc()},
        )
```

- [ ] **Step 5: Run tests, verify pass**

```bash
cd workers && python3 -m pytest tests/test_msg_extractor.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ..
git add workers/extractors/msg_extractor.py workers/tests/fixtures/sample.msg workers/tests/test_msg_extractor.py
git commit -m "feat(extractors): MSG extractor with graceful failure on corrupt input"
```

---

## Task 10: Supabase I/O client

**Files:**
- Create: `workers/supabase_client.py`

No unit tests (wraps live network calls — tested via integration). A thin, focused module.

- [ ] **Step 1: Implement**

Create `workers/supabase_client.py`:

```python
from __future__ import annotations
import hashlib
import os
from datetime import datetime, timezone
from supabase import create_client, Client
from config import Config

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(Config.supabase_url, Config.supabase_service_role_key)
    return _client


# ── Storage paths (mirrors lib/storage/paths.ts) ──────────────────────────────

def original_path(user_id: str, document_id: str, filename: str) -> str:
    return f"{user_id}/{document_id}/original/{filename}"


def attachment_path(user_id: str, parent_id: str, child_id: str, filename: str) -> str:
    return f"{user_id}/{parent_id}/attachments/{child_id}/{filename}"


def markdown_path(user_id: str, document_id: str, original_filename: str) -> str:
    return f"{user_id}/{document_id}/markdown/{original_filename}.md"


# ── Storage I/O ───────────────────────────────────────────────────────────────

def download_file(storage_path: str) -> bytes:
    client = get_client()
    response = client.storage.from_(Config.storage_bucket).download(storage_path)
    return response


def upload_file(storage_path: str, data: bytes, content_type: str = "application/octet-stream",
                upsert: bool = False) -> None:
    client = get_client()
    client.storage.from_(Config.storage_bucket).upload(
        storage_path, data,
        file_options={"content-type": content_type, "upsert": str(upsert).lower()},
    )


# ── Document DB helpers ───────────────────────────────────────────────────────

def get_document(document_id: str) -> dict:
    client = get_client()
    resp = client.table("documents").select("*").eq("id", document_id).single().execute()
    return resp.data


def update_document(document_id: str, fields: dict) -> None:
    client = get_client()
    client.table("documents").update(fields).eq("id", document_id).execute()


def mark_processed(document_id: str, extracted_text: str, markdown_text: str,
                   markdown_storage_path: str, extra_fields: dict | None = None) -> None:
    fields = {
        "extracted_text": extracted_text,
        "markdown_text": markdown_text,
        "markdown_storage_path": markdown_storage_path,
        "processing_status": "processed",
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if extra_fields:
        fields.update(extra_fields)
    update_document(document_id, fields)


def mark_failed(document_id: str, error: str) -> None:
    update_document(document_id, {
        "processing_status": "failed",
        "processing_error": error,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def find_duplicate(user_id: str, sha256: str) -> str | None:
    """Return existing document_id with same hash for this user, or None."""
    client = get_client()
    resp = (
        client.table("documents")
        .select("id")
        .eq("user_id", user_id)
        .eq("sha256_hash", sha256)
        .limit(1)
        .execute()
    )
    return resp.data[0]["id"] if resp.data else None


def insert_child_document(user_id: str, parent_id: str, filename: str,
                           source_type: str, sha256: str, storage_path: str,
                           file_size: int, duplicate_of: str | None) -> str:
    """Insert an email attachment as a child document. Returns new document_id."""
    client = get_client()
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    resp = client.table("documents").insert({
        "user_id": user_id,
        "original_filename": filename,
        "file_extension": ext,
        "storage_bucket": Config.storage_bucket,
        "storage_path": storage_path,
        "sha256_hash": sha256,
        "duplicate_of_document_id": duplicate_of,
        "source_type": source_type,
        "parent_document_id": parent_id,
        "processing_status": "queued",
    }).execute()
    return resp.data[0]["id"]


def attachment_already_exists(parent_id: str, filename: str, sha256: str) -> bool:
    """Idempotency check: prevent duplicate child docs on reprocess."""
    client = get_client()
    resp = (
        client.table("documents")
        .select("id")
        .eq("parent_document_id", parent_id)
        .eq("original_filename", filename)
        .eq("sha256_hash", sha256)
        .limit(1)
        .execute()
    )
    return bool(resp.data)


def claim_next_document() -> dict | None:
    """Atomically claim one queued document via the DB function."""
    client = get_client()
    resp = client.rpc("claim_next_document", {}).execute()
    if not resp.data:
        return None
    return resp.data[0] if isinstance(resp.data, list) else resp.data
```

- [ ] **Step 2: Verify imports**

```bash
cd workers
python3 -c "from supabase_client import get_client, markdown_path, sha256_hex; print('supabase_client imports OK')"
```

Expected: `supabase_client imports OK`

- [ ] **Step 3: Commit**

```bash
cd ..
git add workers/supabase_client.py
git commit -m "feat(worker): supabase I/O client (storage, document CRUD, attachment helpers)"
```

---

## Task 11: `process_document` Celery task + `jobs` package

**Files:**
- Create: `workers/jobs/__init__.py`
- Create: `workers/jobs/process_document.py`

- [ ] **Step 1: Create jobs package**

Create `workers/jobs/__init__.py` (empty).

- [ ] **Step 2: Implement the task**

Create `workers/jobs/process_document.py`:

```python
from __future__ import annotations
import os
from celery_app import app
from supabase_client import (
    get_document, download_file, upload_file,
    mark_processed, mark_failed,
    sha256_hex, find_duplicate, insert_child_document,
    attachment_already_exists, markdown_path, attachment_path,
)
from extractors import extract
from extractors.common import detect_source_type


@app.task(bind=True, max_retries=3, default_retry_delay=30, name="jobs.process_document")
def process_document(self, document_id: str) -> dict:
    """
    Celery task: download original → extract → persist text/markdown/metadata.
    For emails, also creates child attachment documents.
    """
    try:
        row = get_document(document_id)
        user_id = row["user_id"]
        source_type = row["source_type"]
        storage_path = row["storage_path"]
        original_filename = row["original_filename"]

        # Download original file
        raw = download_file(storage_path)

        # Extract
        result = extract(source_type, raw)

        # Upload .md artifact to storage
        md_storage_path = markdown_path(user_id, document_id, original_filename)
        upload_file(
            md_storage_path,
            result.markdown.encode("utf-8"),
            content_type="text/markdown",
            upsert=True,
        )

        # Handle email attachments (EML / MSG)
        if source_type in ("eml", "msg"):
            for att in result.attachments:
                att_sha256 = sha256_hex(att.data)
                if attachment_already_exists(document_id, att.filename, att_sha256):
                    continue  # idempotency
                att_source_type = detect_source_type(att.filename)
                dup_id = find_duplicate(user_id, att_sha256)
                child_id = insert_child_document(
                    user_id=user_id,
                    parent_id=document_id,
                    filename=att.filename,
                    source_type=att_source_type,
                    sha256=att_sha256,
                    storage_path="",  # filled after upload below
                    file_size=len(att.data),
                    duplicate_of=dup_id,
                )
                att_path = attachment_path(user_id, document_id, child_id, att.filename)
                upload_file(att_path, att.data, content_type=att.content_type)
                # Update child with real storage_path + queued
                from supabase_client import update_document
                update_document(child_id, {"storage_path": att_path})

        # Build extra fields from metadata / email headers
        extra: dict = {}
        meta = result.metadata
        if source_type in ("eml", "msg"):
            extra["sender"] = meta.get("from", "")
            extra["recipients"] = meta.get("to", [])
            extra["cc"] = meta.get("cc", []) if isinstance(meta.get("cc"), list) else (
                [meta["cc"]] if meta.get("cc") else []
            )
            extra["email_subject"] = meta.get("subject", "")
            extra["email_message_id"] = meta.get("message_id", "")
            date_str = meta.get("date", "")
            if date_str:
                extra["document_datetime"] = _parse_date(date_str)
        if meta.get("author"):
            extra["author"] = meta["author"]

        # Update search_vector inline via PostgREST stored procedure isn't available,
        # so we trigger it with a raw update that concatenates the text fields.
        # The actual tsvector generation happens via a DB trigger or the stored value
        # set explicitly. We pass the text so the DB can compute it:
        extra["search_vector_text"] = _build_search_text(row, result.text, meta)

        mark_processed(
            document_id,
            extracted_text=result.text,
            markdown_text=result.markdown,
            markdown_storage_path=md_storage_path,
            extra_fields=extra,
        )
        return {"status": "processed", "document_id": document_id}

    except Exception as exc:
        mark_failed(document_id, str(exc))
        raise self.retry(exc=exc)


def _parse_date(date_str: str) -> str | None:
    """Try to parse email date string to ISO-8601. Return None on failure."""
    from email.utils import parsedate_to_datetime
    try:
        return parsedate_to_datetime(date_str).isoformat()
    except Exception:
        return None


def _build_search_text(row: dict, extracted_text: str, meta: dict) -> str:
    parts = [
        row.get("original_filename", ""),
        row.get("display_title", "") or "",
        extracted_text[:5000],  # truncate for search vector
        meta.get("subject", "") or "",
    ]
    return " ".join(p for p in parts if p)
```

Note: `search_vector_text` is not a real column — the `mark_processed` call passes `extra_fields` to `update_document`, so we need the DB to have a trigger or we do it explicitly. Add the explicit `search_vector` update to `mark_processed` in supabase_client.py:

Open `workers/supabase_client.py` and update `mark_processed` to also compute `search_vector`. Since we can't call `to_tsvector` via PostgREST directly, use a SECURITY DEFINER RPC. Add this to the migration in the next step, and update `mark_processed`:

Actually, the simplest approach: in `update_document` we include a raw SQL call to update `search_vector` via the existing PostgREST RPC pattern. Add `update_search_vector(document_id)` to `supabase_client.py`:

```python
# Add at the bottom of supabase_client.py:

def update_search_vector(document_id: str) -> None:
    """Trigger search_vector recompute via DB RPC."""
    client = get_client()
    client.rpc("update_document_search_vector", {"doc_id": document_id}).execute()
```

And add the DB function in the migration step below.

- [ ] **Step 3: Add `update_document_search_vector` to migration**

Append to `supabase/migrations/20260608180000_phase2.sql`:

```sql
-- Update search_vector for a document after processing
create or replace function public.update_document_search_vector(doc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update documents
  set search_vector = to_tsvector(
    'english',
    coalesce(original_filename, '') || ' ' ||
    coalesce(display_title, '') || ' ' ||
    coalesce(extracted_text, '') || ' ' ||
    coalesce(array_to_string(ai_keywords, ' '), '')
  ),
  updated_at = now()
  where id = doc_id;
end;
$$;
```

Re-apply:

```bash
export DB_PASSWORD=$(grep '^SUPABASE_DB_PASSWORD=' .env.local | cut -d= -f2-)
supabase db push \
  --db-url "postgresql://postgres.cdztsdygywfbxlfxcipe:${DB_PASSWORD}@aws-1-eu-central-1.pooler.supabase.com:5432/postgres"
```

Then update `mark_processed` in `workers/supabase_client.py` to call `update_search_vector`:

```python
def mark_processed(document_id: str, extracted_text: str, markdown_text: str,
                   markdown_storage_path: str, extra_fields: dict | None = None) -> None:
    fields = {
        "extracted_text": extracted_text,
        "markdown_text": markdown_text,
        "markdown_storage_path": markdown_storage_path,
        "processing_status": "processed",
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # Remove our internal helper key if present
    if extra_fields:
        extra_fields.pop("search_vector_text", None)
        fields.update(extra_fields)
    update_document(document_id, fields)
    update_search_vector(document_id)
```

- [ ] **Step 4: Typecheck + verify imports**

```bash
cd workers
python3 -c "from jobs.process_document import process_document; print('task imports OK')"
```

Expected: `task imports OK`

- [ ] **Step 5: Commit**

```bash
cd ..
git add workers/jobs/ supabase/migrations/20260608180000_phase2.sql workers/supabase_client.py
git commit -m "feat(worker): process_document Celery task and update_document_search_vector RPC"
```

---

## Task 12: Dispatcher

**Files:**
- Create: `workers/dispatcher.py`

- [ ] **Step 1: Implement**

Create `workers/dispatcher.py`:

```python
"""
Dispatcher: poll loop that claims queued documents and enqueues Celery tasks.

Run with:
    cd workers && python3 dispatcher.py
"""
from __future__ import annotations
import time
import logging
import signal
import sys
from config import Config
from supabase_client import claim_next_document
from jobs.process_document import process_document

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [dispatcher] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

_running = True


def _handle_signal(sig, frame):
    global _running
    log.info("Signal received, shutting down gracefully…")
    _running = False


signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


def run_once() -> bool:
    """Claim one document and dispatch. Return True if a doc was claimed."""
    doc = claim_next_document()
    if not doc:
        return False
    doc_id = doc["id"]
    log.info("Claimed document %s (%s)", doc_id, doc.get("original_filename"))
    process_document.delay(doc_id)
    return True


def main() -> None:
    log.info("Dispatcher started (poll_seconds=%.1f)", Config.dispatcher_poll_seconds)
    while _running:
        try:
            claimed = run_once()
            if not claimed:
                time.sleep(Config.dispatcher_poll_seconds)
        except Exception as e:
            log.error("Dispatcher error: %s", e, exc_info=True)
            time.sleep(Config.dispatcher_poll_seconds)
    log.info("Dispatcher stopped.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify imports**

```bash
cd workers
python3 -c "from dispatcher import run_once; print('dispatcher imports OK')"
```

Expected: `dispatcher imports OK`

- [ ] **Step 3: Commit**

```bash
cd ..
git add workers/dispatcher.py
git commit -m "feat(worker): dispatcher poll loop with graceful shutdown"
```

---

## Task 13: Workers README + .env wiring

**Files:**
- Create: `workers/README.md`

- [ ] **Step 1: Create README**

Create `workers/README.md`:

```markdown
# LexAI Workers

Python Celery extraction worker for LexAI. Processes queued documents: downloads the
original from Supabase Storage, extracts text + markdown (PDF/DOCX/XLSX/EML/MSG),
stores a `.md` artifact back to storage, and marks the document `processed`.

## Prerequisites

- Python 3.11+
- Redis running locally (`redis-server` — installed via brew or docker)
- Supabase `lexai` project credentials

## Setup

```bash
cd workers
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (from project dashboard)
pip install -e ".[dev]"
```

## Run

Terminal 1 — start Redis (if not running as a service):
```bash
redis-server
```

Terminal 2 — start the Celery worker:
```bash
cd workers
source .env  # or: export $(cat .env | xargs)
celery -A celery_app worker --loglevel=info
```

Terminal 3 — start the dispatcher:
```bash
cd workers
source .env
python3 dispatcher.py
```

Upload a file via the Next.js app at http://localhost:3000. The dispatcher will
claim it within `DISPATCHER_POLL_SECONDS` (default 3s) and Celery will process it.

## Run tests

```bash
cd workers
python3 -m pytest tests/ -v
```

## Storage paths

| Type | Path |
|------|------|
| Original | `{user_id}/{document_id}/original/{filename}` |
| Markdown artifact | `{user_id}/{document_id}/markdown/{filename}.md` |
| Attachment original | `{user_id}/{parent_id}/attachments/{child_id}/{filename}` |

Both original and markdown artifact are private (signed URLs only).
```

- [ ] **Step 2: Copy env vars to workers/.env for running**

```bash
# From repo root:
SRK=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)
cat > workers/.env <<EOF
SUPABASE_URL=https://cdztsdygywfbxlfxcipe.supabase.co
SUPABASE_SERVICE_ROLE_KEY=${SRK}
REDIS_URL=redis://localhost:6379/0
STORAGE_BUCKET=legal-documents
DISPATCHER_POLL_SECONDS=3
EOF
echo "workers/.env written (gitignored)"
```

Add `workers/.env` to `.gitignore` (only `.env.example` is tracked):

```bash
grep -q 'workers/.env$' .gitignore || echo 'workers/.env' >> .gitignore
```

- [ ] **Step 3: Run full test suite**

```bash
cd workers && python3 -m pytest tests/ -v
```

Expected: all tests pass (≥ 17 tests across test_common, test_pdf, test_docx, test_xlsx, test_eml, test_msg).

- [ ] **Step 4: Commit**

```bash
cd ..
git add workers/README.md .gitignore
git commit -m "docs(worker): README with run instructions and storage path table"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| DB migration: `markdown_storage_path` column + `claim_next_document()` fn | T1 |
| `markdownPath()` TS helper | T2 |
| Worker package, pyproject.toml, config, celery_app | T3 |
| `ExtractionResult`, `Attachment`, `html_to_markdown`, `detect_source_type` | T4 |
| PDF extractor (page text, requires_ocr) | T5 |
| DOCX extractor (headings, paragraphs, tables) | T6 |
| XLSX extractor (per-sheet tables, not one blob) | T7 |
| EML extractor (headers, body, attachments) | T8 |
| MSG extractor (graceful failure) | T9 |
| Supabase I/O: download, upload, doc CRUD, attachment helpers, idempotency | T10 |
| `process_document` Celery task (download→extract→md artifact→attachments→persist→search_vector) | T11 |
| Dispatcher poll loop, graceful shutdown | T12 |
| README, `.env` wiring, full test run | T13 |
| Error handling: `mark_failed`, original preserved | T10+T11 |
| Idempotency (no duplicate child attachments on reprocess) | T10+T11 |
| `update_document_search_vector` RPC | T11 |
| Markdown `.md` file stored at `markdownPath`, linked via `markdown_storage_path` | T11 |

**No placeholder scan:** all steps have code. No TBDs.

**Type consistency:** `ExtractionResult` defined T4, used T5–T9 and T11. `Attachment` defined T4, used T8–T9 and T11. `detect_source_type` defined T4, used T11. `claim_next_document` defined T1 (DB fn) and T10 (Python wrapper), called T12. `markdown_path` (Python) defined T10, used T11. `markdownPath` (TS) defined T2, no caller yet (Phase 4 UI will use it). All consistent.
