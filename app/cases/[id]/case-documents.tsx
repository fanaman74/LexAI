"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Doc = {
  id: string;
  original_filename: string;
  display_title: string | null;
  source_type: string;
  processing_status: string;
};

type Case = {
  id: string;
  name: string;
  status: string;
  description: string | null;
};

interface CaseDocumentsProps {
  caseData: Case;
  documents: Doc[];
  availableDocs: Doc[];
}

function StatusBadge({ status }: { status: string }) {
  let cls = "rounded px-2 py-0.5 text-xs ";
  if (status === "processed") cls += "bg-green-100 text-green-800";
  else if (status === "failed") cls += "bg-red-100 text-red-800";
  else if (status === "queued" || status === "processing") cls += "bg-amber-100 text-amber-800";
  else cls += "bg-gray-100 text-gray-600";
  return <span className={cls}>{status}</span>;
}

export function CaseDocuments({ caseData, documents, availableDocs }: CaseDocumentsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState(availableDocs[0]?.id ?? "");

  async function handleArchiveToggle() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: caseData.status === "active" ? "archived" : "active" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to update case");
      }
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this case?")) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseData.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete case");
      }
      router.push("/cases");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }

  async function handleRemoveDoc(docId: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseData.id}/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to remove document");
      }
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDocId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseData.id}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: selectedDocId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to add document");
      }
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* Case actions */}
      <div className="mb-6 flex gap-2">
        <button
          onClick={handleArchiveToggle}
          disabled={loading}
          className="rounded border px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {caseData.status === "active" ? "Archive case" : "Unarchive case"}
        </button>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Delete case
        </button>
      </div>

      {/* Documents in case */}
      <h2 className="text-sm font-semibold text-gray-700 mb-2">Documents in this case</h2>
      {documents.length === 0 ? (
        <p className="text-sm text-gray-500 mb-4">No documents assigned yet.</p>
      ) : (
        <table className="mb-6 w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Filename</th>
              <th className="pb-2">Source</th>
              <th className="pb-2">Status</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} className="border-t hover:bg-gray-50">
                <td className="py-2 pr-4">
                  <Link href={`/documents/${doc.id}`} className="text-blue-600 hover:underline">
                    {doc.display_title ?? doc.original_filename}
                  </Link>
                </td>
                <td className="pr-4 text-gray-600">{doc.source_type}</td>
                <td className="pr-4">
                  <StatusBadge status={doc.processing_status} />
                </td>
                <td>
                  <button
                    onClick={() => handleRemoveDoc(doc.id)}
                    disabled={loading}
                    className="text-xs text-red-500 hover:underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Assign document */}
      {availableDocs.length > 0 && (
        <form onSubmit={handleAddDoc} className="flex items-center gap-2">
          <select
            value={selectedDocId}
            onChange={(e) => setSelectedDocId(e.target.value)}
            className="rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            {availableDocs.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.display_title ?? doc.original_filename}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={loading || !selectedDocId}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add to case
          </button>
        </form>
      )}
    </div>
  );
}
