"use client";
import { useState } from "react";

export function ReprocessButton({ documentId }: { documentId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function process() {
    setState("loading");
    setMsg("");
    const res = await fetch(`/api/documents/${documentId}/process`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setMsg(`Done — ${data.characters?.toLocaleString() ?? "?"} chars`);
      setState("done");
      setTimeout(() => window.location.reload(), 1200);
    } else {
      setMsg(data.error ?? "Failed");
      setState("error");
    }
  }

  if (state === "done") return <span style={{ fontSize: "12px", color: "#4ade80" }}>✓ {msg}</span>;
  if (state === "error") return <span style={{ fontSize: "12px", color: "#ef4444" }} title={msg}>Failed</span>;

  return (
    <button
      onClick={process}
      disabled={state === "loading"}
      style={{
        fontSize: "12px",
        padding: "3px 10px",
        borderRadius: "5px",
        border: "1px solid #f59e0b55",
        backgroundColor: "transparent",
        color: state === "loading" ? "#6b7280" : "#f59e0b",
        cursor: state === "loading" ? "not-allowed" : "pointer",
      }}
    >
      {state === "loading" ? "Processing…" : "Process"}
    </button>
  );
}
