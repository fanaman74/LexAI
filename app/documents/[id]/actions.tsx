"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  documentId: string;
  hasMarkdown: boolean;
};

export function DocumentActions({ documentId, hasMarkdown }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [reconstructed, setReconstructed] = useState<string | null>(null);

  async function viewOriginal() {
    setLoading("original");
    try {
      const res = await fetch(`/api/documents/${documentId}/signed-url`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to get URL");
      window.open(data.url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function viewMarkdown() {
    setLoading("markdown");
    try {
      const res = await fetch(`/api/documents/${documentId}/signed-url?kind=markdown`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to get URL");
      window.open(data.url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function reconstruct() {
    setLoading("reconstruct");
    try {
      const res = await fetch(`/api/documents/${documentId}/reconstruct`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to reconstruct");
      setReconstructed(data.markdown ?? JSON.stringify(data));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function reprocess() {
    setLoading("reprocess");
    try {
      const res = await fetch(`/api/documents/${documentId}/reprocess`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to reprocess");
      }
      router.refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function deleteDoc() {
    if (!confirm("Delete this document?")) return;
    setLoading("delete");
    try {
      const res = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete");
      }
      router.push("/documents");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
      setLoading(null);
    }
  }

  const btnCls = "rounded border px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50";

  return (
    <div>
      <div className="flex gap-2 flex-wrap">
        <button className={btnCls} onClick={viewOriginal} disabled={loading !== null}>
          {loading === "original" ? "Loading…" : "View original"}
        </button>
        {hasMarkdown && (
          <button className={btnCls} onClick={viewMarkdown} disabled={loading !== null}>
            {loading === "markdown" ? "Loading…" : "View markdown"}
          </button>
        )}
        <button className={btnCls} onClick={reconstruct} disabled={loading !== null}>
          {loading === "reconstruct" ? "Loading…" : "Reconstruct"}
        </button>
        <button className={btnCls} onClick={reprocess} disabled={loading !== null}>
          {loading === "reprocess" ? "Loading…" : "Reprocess"}
        </button>
        <button
          className={btnCls + " text-red-600 hover:bg-red-50"}
          onClick={deleteDoc}
          disabled={loading !== null}
        >
          {loading === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
      {reconstructed !== null && (
        <details open className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">Reconstructed markdown</summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-700 max-h-96 overflow-y-auto rounded border p-3 bg-gray-50">
            {reconstructed}
          </pre>
        </details>
      )}
    </div>
  );
}
