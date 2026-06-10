export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    let detail = body;
    try { detail = JSON.parse(body).detail ?? body; } catch { /* plain text */ }
    throw new Error(detail);
  }
  return res.json();
}

export interface FileLocation {
  root_folder: string;
  subfolder_path: string;
  filename: string;
}

export interface FileRow {
  id: number;
  original_name: string;
  file_type: string;
  size_bytes: number;
  status: string;
  error_message: string | null;
  created_at: string;
  locations: FileLocation[];
  tags: string[];
  has_markdown: boolean;
  keywords: string[];
  summary: string | null;
}

export interface FolderEntry {
  root_folder: string;
  subfolder_path: string;
  count: number;
}

export interface SemanticResult {
  file_id: number;
  original_name: string;
  file_type: string;
  score: number;
  snippet: string;
}

export interface ChatMsg {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface Chat {
  id: number;
  file_ids: number[];
  title: string;
  created_at: string;
  messages?: ChatMsg[];
}

export interface IndexStatus {
  status: string;
  total: number;
  indexed: number;
  failed: number;
  error: string | null;
}

export interface ScanProgress {
  status: string;
  root: string;
  total: number;
  done: number;
  new: number;
  existing: number;
  converted: number;
  failed: number;
  ocr: number;
  skipped: string[];
  error: string | null;
}

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

export interface SearchResult {
  chunk_id: number;
  document_id: number;
  original_filename: string;
  file_type: string;
  parent_document_id: number | null;
  page_number: number | null;
  section_title: string | null;
  chunk_text: string;
  vec_score: number;
  fts_score: number;
  rrf_score: number;
  neighbors: Array<{ chunk_index: number; chunk_text: string; page_number: number | null }>;
  doc_summary: string | null;
  doc_keywords: string[];
  email_metadata: Record<string, string> | null;
}

export async function searchDocuments(
  q: string,
  options: { file_type?: string; limit?: number } = {}
): Promise<{ results: SearchResult[]; query: string }> {
  const params = new URLSearchParams({ q });
  if (options.file_type) params.set("file_type", options.file_type);
  if (options.limit) params.set("limit", String(options.limit));
  const res = await fetch(`/api/search?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
