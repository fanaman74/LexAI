import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import type { FileRow } from "../api";

const PRESETS = [
  { label: "Summarize", prompt: "Summarize each document in plain language, then give an overall summary." },
  { label: "Parties & dates", prompt: "Extract all parties, roles, and key dates from these documents as a table." },
  { label: "Obligations & deadlines", prompt: "List every obligation and deadline, who bears it, and the source clause." },
];

interface Analysis {
  id: number; file_ids: number[]; prompt: string;
  response: string; model: string; created_at: string;
}

export default function Analyze() {
  const [params] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean).map(Number);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Analysis[]>([]);

  useEffect(() => {
    api<{ files: FileRow[] }>("/api/files").then(({ files }) =>
      setFiles(files.filter((f) => ids.includes(f.id))));
    api<{ analyses: Analysis[] }>("/api/analyses").then((r) => setHistory(r.analyses));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    if (!prompt.trim() || ids.length === 0) return;
    setBusy(true); setError(""); setResult("");
    try {
      const res = await api<{ response: string }>("/api/analyses", {
        method: "POST",
        body: JSON.stringify({ file_ids: ids, prompt }),
      });
      setResult(res.response);
      const h = await api<{ analyses: Analysis[] }>("/api/analyses");
      setHistory(h.analyses);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="bg-amber-50 border border-amber-300 rounded-md p-3 text-sm text-amber-800">
        ⚠️ AI analysis sends document text to OpenRouter (free tier). Do not use for
        documents that must never leave this machine.
      </div>

      <section className="bg-white rounded-md shadow p-4">
        <h2 className="font-semibold mb-2">Selected documents ({ids.length})</h2>
        {ids.length === 0 ? (
          <p className="text-sm text-slate-500">
            No documents selected. <Link to="/library" className="text-blue-700 underline">
            Select files in the Library</Link> first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {files.map((f) => (
              <span key={f.id} className="bg-slate-100 rounded-full px-3 py-1 text-sm">
                {f.original_name}
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => setPrompt(p.prompt)}
              className="border border-slate-300 rounded-full px-3 py-1 text-sm hover:bg-slate-100">
              {p.label}
            </button>
          ))}
        </div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
          rows={3} placeholder="Ask a question about the selected documents…"
          className="border rounded-md w-full px-3 py-2 mt-3" />
        <button onClick={run} disabled={busy || ids.length === 0 || !prompt.trim()}
          className="mt-2 bg-emerald-600 disabled:bg-slate-300 text-white rounded-md px-4 py-2 font-medium">
          {busy ? "Analyzing…" : "Run analysis"}
        </button>
        {error && <p className="text-red-600 mt-2 text-sm">{error}</p>}
      </section>

      {result && (
        <section className="bg-white rounded-md shadow p-4 prose max-w-none">
          <ReactMarkdown>{result}</ReactMarkdown>
        </section>
      )}

      <section className="bg-white rounded-md shadow p-4">
        <h2 className="font-semibold mb-2">History</h2>
        {history.length === 0 && <p className="text-sm text-slate-500">No analyses yet.</p>}
        {history.map((a) => (
          <details key={a.id} className="border-b py-2">
            <summary className="cursor-pointer text-sm">
              <span className="font-medium">{a.prompt.slice(0, 80)}</span>
              <span className="text-slate-400"> · {a.created_at} · {a.file_ids.length} file(s)</span>
            </summary>
            <div className="prose max-w-none mt-2 text-sm">
              <ReactMarkdown>{a.response}</ReactMarkdown>
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
