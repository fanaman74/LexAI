"use client";
import { useState } from "react";

export function ReprocessButton({ documentId }: { documentId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function reprocess() {
    setState("loading");
    const res = await fetch(`/api/documents/${documentId}/reprocess`, { method: "POST" });
    setState(res.ok ? "done" : "error");
    if (res.ok) setTimeout(() => window.location.reload(), 800);
  }

  if (state === "done") return <span style={{ fontSize: "12px", color: "#4ade80" }}>Queued ✓</span>;
  if (state === "error") return <span style={{ fontSize: "12px", color: "#ef4444" }}>Failed</span>;

  return (
    <button
      onClick={reprocess}
      disabled={state === "loading"}
      style={{
        fontSize: "12px",
        padding: "3px 10px",
        borderRadius: "5px",
        border: "1px solid #f59e0b55",
        backgroundColor: "transparent",
        color: "#f59e0b",
        cursor: state === "loading" ? "not-allowed" : "pointer",
        opacity: state === "loading" ? 0.6 : 1,
      }}
    >
      {state === "loading" ? "…" : "Reprocess"}
    </button>
  );
}
