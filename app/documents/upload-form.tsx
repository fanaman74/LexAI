"use client";
import { useState } from "react";

type Result = {
  document_id?: string; original_filename: string;
  status: string; is_duplicate?: boolean; error?: string;
};

export function UploadForm() {
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
    const json = await res.json();
    setResults(json.results ?? []);
    setBusy(false);
  }

  return (
    <div>
      <form onSubmit={onSubmit} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          type="file"
          name="files"
          multiple
          required
          accept=".pdf,.docx,.xlsx,.msg,.eml"
          style={{ color: "#9ca3af", fontSize: "13px" }}
        />
        <button
          disabled={busy}
          style={{
            padding: "8px 16px",
            fontSize: "13px",
            fontWeight: 600,
            borderRadius: "6px",
            backgroundColor: busy ? "#555" : "#f59e0b",
            color: "#000",
            border: "none",
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {busy ? "Uploading…" : "+ Add document"}
        </button>
      </form>
      {results.length > 0 && (
        <ul style={{ marginTop: "10px", listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          {results.map((r, i) => (
            <li key={i} style={{ display: "flex", gap: "8px", fontSize: "13px" }}>
              <span style={{ color: "#ffffff" }}>{r.original_filename}</span>
              <span style={{ color: "#9ca3af" }}>{r.status}</span>
              {r.is_duplicate && <span style={{ color: "#f59e0b" }}>duplicate</span>}
              {r.error && <span style={{ color: "#ef4444" }}>{r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
