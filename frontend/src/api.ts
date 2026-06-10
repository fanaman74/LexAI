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
