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
      <form onSubmit={onSubmit} className="mb-4 flex items-center gap-2">
        <input type="file" name="files" multiple required
          accept=".pdf,.docx,.xlsx,.msg,.eml" />
        <button disabled={busy}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {busy ? "Uploading…" : "Upload"}
        </button>
      </form>
      <ul className="space-y-1 text-sm">
        {results.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span>{r.original_filename}</span>
            <span className="text-gray-500">{r.status}</span>
            {r.is_duplicate && <span className="text-amber-600">duplicate</span>}
            {r.error && <span className="text-red-600">{r.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
