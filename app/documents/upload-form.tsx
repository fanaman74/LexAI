"use client";
import { useEffect, useRef, useState } from "react";

type Result = {
  document_id?: string; original_filename: string;
  status: string; is_duplicate?: boolean; error?: string;
};
type Client = { id: string; name: string };

const ACCEPTED_EXTS = new Set([".pdf", ".docx", ".xlsx", ".msg", ".eml"]);

function filterFiles(fileList: FileList): File[] {
  return Array.from(fileList).filter((f) => {
    const dot = f.name.lastIndexOf(".");
    return dot !== -1 && ACCEPTED_EXTS.has(f.name.slice(dot).toLowerCase());
  });
}

async function submitFiles(files: File[], clientId: string): Promise<Result[]> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  if (clientId) fd.append("client_id", clientId);
  const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
  const json = await res.json();
  return json.results ?? [];
}

export function UploadForm() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/clients").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setClients(data);
    }).catch(() => {});
  }, []);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = filterFiles(fileList);
    if (files.length === 0) return;
    setBusy(true);
    setResults([]);
    setProgress(`Uploading ${files.length} file${files.length !== 1 ? "s" : ""}…`);
    const res = await submitFiles(files, clientId);
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

  const sectionStyle = (color: string) => ({
    padding: "12px 14px",
    borderRadius: "8px",
    border: `1px solid ${color}33`,
    backgroundColor: `${color}0d`,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: "10px" }}>
      {/* Client selector */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <label style={{ fontSize: "12px", color: "#9ca3af", whiteSpace: "nowrap" as const }}>Client:</label>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          style={{
            padding: "7px 10px",
            fontSize: "13px",
            borderRadius: "6px",
            border: "1px solid #2a2a2a",
            backgroundColor: "#111",
            color: clientId ? "#ffffff" : "#6b7280",
            outline: "none",
            minWidth: "200px",
          }}
        >
          <option value="">— No client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {clients.length === 0 && (
          <a href="/clients" style={{ fontSize: "12px", color: "#f59e0b", textDecoration: "none" }}>
            + Add clients
          </a>
        )}
      </div>

      {/* File upload */}
      <div style={sectionStyle("#f59e0b")}>
        <p style={{ fontSize: "11px", fontWeight: 600, color: "#f59e0b", marginBottom: "8px", letterSpacing: "0.05em", textTransform: "uppercase" as const }}>
          Upload files
        </p>
        <form onSubmit={onSubmit} style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" as const }}>
          <input
            ref={fileRef}
            type="file"
            name="files"
            multiple
            required
            accept=".pdf,.docx,.xlsx,.msg,.eml"
            style={{ color: "#d1d5db", fontSize: "13px" }}
          />
          <button disabled={busy} style={btnStyle(busy)}>
            {busy ? "Uploading…" : "+ Add files"}
          </button>
        </form>
      </div>

      {/* Folder upload */}
      <div style={sectionStyle("#60a5fa")}>
        <p style={{ fontSize: "11px", fontWeight: 600, color: "#60a5fa", marginBottom: "8px", letterSpacing: "0.05em", textTransform: "uppercase" as const }}>
          Upload folder <span style={{ fontWeight: 400, color: "#6b7280" }}>— includes all subfolders</span>
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            ref={folderRef}
            id="folder-input"
            type="file"
            // @ts-expect-error — webkitdirectory is not in React types
            webkitdirectory=""
            multiple
            onChange={(e) => handleFiles(e.currentTarget.files)}
            style={{ display: "none" }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => folderRef.current?.click()}
            style={{ ...btnStyle(busy), backgroundColor: busy ? "#555" : "#60a5fa" }}
          >
            {busy ? "Uploading…" : "+ Add folder"}
          </button>
          <span style={{ fontSize: "13px", color: "#6b7280" }} id="folder-label">No folder chosen</span>
        </div>
      </div>

      {progress && (
        <p style={{ fontSize: "13px", color: "#f59e0b" }}>{progress}</p>
      )}

      {results.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
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
