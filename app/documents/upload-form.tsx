"use client";
import { useRef, useState } from "react";

type Result = {
  document_id?: string; original_filename: string;
  status: string; is_duplicate?: boolean; error?: string;
};

const ACCEPTED_EXTS = new Set([".pdf", ".docx", ".xlsx", ".msg", ".eml"]);

function filterFiles(fileList: FileList): File[] {
  return Array.from(fileList).filter((f) => {
    const dot = f.name.lastIndexOf(".");
    return dot !== -1 && ACCEPTED_EXTS.has(f.name.slice(dot).toLowerCase());
  });
}

async function submitFiles(files: File[]): Promise<Result[]> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
  const json = await res.json();
  return json.results ?? [];
}

export function UploadForm() {
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = filterFiles(fileList);
    if (files.length === 0) return;
    setBusy(true);
    setResults([]);
    setProgress(`Uploading ${files.length} file${files.length !== 1 ? "s" : ""}…`);
    const res = await submitFiles(files);
    setResults(res);
    setProgress("");
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (folderRef.current) folderRef.current.value = "";
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await handleFiles(fileRef.current?.files ?? null);
  }

  const btnStyle = (disabled: boolean) => ({
    padding: "8px 16px",
    fontSize: "13px",
    fontWeight: 600,
    borderRadius: "6px",
    backgroundColor: disabled ? "#555" : "#f59e0b",
    color: "#000",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    whiteSpace: "nowrap" as const,
  });

  return (
    <div>
      {/* File upload */}
      <form onSubmit={onSubmit} style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <input
          ref={fileRef}
          type="file"
          name="files"
          multiple
          required
          accept=".pdf,.docx,.xlsx,.msg,.eml"
          style={{ color: "#9ca3af", fontSize: "13px" }}
        />
        <button disabled={busy} style={btnStyle(busy)}>
          {busy ? "Uploading…" : "+ Add files"}
        </button>
      </form>

      {/* Folder upload */}
      <div style={{ marginTop: "10px" }}>
        <p style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
          Or upload a folder (all subfolders included):
        </p>
        <input
          ref={folderRef}
          type="file"
          // @ts-expect-error — webkitdirectory is not in React types
          webkitdirectory=""
          multiple
          onChange={(e) => handleFiles(e.currentTarget.files)}
          style={{ color: "#9ca3af", fontSize: "13px" }}
        />
      </div>

      {progress && (
        <p style={{ marginTop: "8px", fontSize: "13px", color: "#f59e0b" }}>{progress}</p>
      )}

      {results.length > 0 && (
        <ul style={{ marginTop: "10px", listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          {results.map((r, i) => (
            <li key={i} style={{ display: "flex", gap: "8px", fontSize: "13px" }}>
              <span style={{ color: "#ffffff" }}>{r.original_filename}</span>
              <span style={{ color: r.status === "queued" ? "#4ade80" : "#9ca3af" }}>{r.status}</span>
              {r.is_duplicate && <span style={{ color: "#f59e0b" }}>duplicate</span>}
              {r.error && <span style={{ color: "#ef4444" }}>{r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
