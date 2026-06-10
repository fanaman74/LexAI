import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import type { FileLocation } from "../api";

const INLINE_TYPES = ["pdf", "txt", "csv", "eml"];

interface Detail {
  id: number;
  original_name: string;
  file_type: string;
  size_bytes: number;
  sha256: string;
  status: string;
  error_message: string | null;
  created_at: string;
  locations: FileLocation[];
  markdown: { content_md: string; converter_used: string;
              converted_at: string; word_count: number } | null;
  tags: string[];
  notes: { id: number; content: string; created_at: string }[];
}

export default function DocumentView() {
  const { id } = useParams();
  const [doc, setDoc] = useState<Detail | null>(null);
  const [tab, setTab] = useState<"md" | "original">("md");
  const [newTag, setNewTag] = useState("");
  const [newNote, setNewNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setDoc(await api<Detail>(`/api/files/${id}`)); }
    catch (e) { setError((e as Error).message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!doc) return <p className="text-slate-400">Loading…</p>;

  async function addTag() {
    if (!newTag.trim()) return;
    await api(`/api/files/${doc!.id}/tags`, {
      method: "POST", body: JSON.stringify({ name: newTag }) });
    setNewTag(""); load();
  }

  async function removeTag(name: string) {
    await api(`/api/files/${doc!.id}/tags/${encodeURIComponent(name)}`,
      { method: "DELETE" });
    load();
  }

  async function addNote() {
    if (!newNote.trim()) return;
    await api(`/api/files/${doc!.id}/notes`, {
      method: "POST", body: JSON.stringify({ content: newNote }) });
    setNewNote(""); load();
  }

  async function retry() {
    await api(`/api/files/${doc!.id}/retry`, { method: "POST" });
    load();
  }

  async function reveal(index: number) {
    try {
      const res = await api<{ ok: boolean; error?: string }>(
        `/api/files/${doc!.id}/reveal`, {
          method: "POST", body: JSON.stringify({ location_index: index }) });
      if (!res.ok && res.error) setError(res.error);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const canInline = INLINE_TYPES.includes(doc.file_type);

  return (
    <div className="max-w-6xl mx-auto flex gap-6">
      <article className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-slate-800">{doc.original_name}</h1>
          <div className="flex items-center gap-2">
            <Link to={`/chat?ids=${doc.id}`}
              className="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm hover:bg-emerald-700">
              💬 Chat
            </Link>
            <Link to="/" className="text-indigo-700 text-sm hover:underline">← Library</Link>
          </div>
        </div>

        <div className="flex gap-1 border-b border-slate-200 mb-4">
          {(["md", "original"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg ${
                tab === t ? "bg-indigo-50 text-indigo-700 border border-b-0 border-slate-200"
                  : "text-slate-500 hover:text-slate-700"}`}>
              {t === "md" ? "Markdown" : "Original"}
            </button>
          ))}
        </div>

        {tab === "md" && (
          doc.markdown ? (
            <div className="prose max-w-none">
              <ReactMarkdown>{doc.markdown.content_md}</ReactMarkdown>
            </div>
          ) : (
            <div>
              <p className="text-amber-700">
                No converted text ({doc.status}
                {doc.error_message ? `: ${doc.error_message}` : ""}).
              </p>
              <button onClick={retry}
                className="mt-2 bg-indigo-600 text-white rounded-lg px-3 py-1 text-sm">
                Retry conversion
              </button>
            </div>
          )
        )}

        {tab === "original" && (
          canInline ? (
            <iframe title="original"
              src={`/api/files/${doc.id}/original?inline=1`}
              className="w-full rounded-lg border border-slate-200"
              style={{ height: "70vh" }} />
          ) : (
            <div className="text-center py-16 text-slate-500">
              <p className="mb-3">
                No in-browser preview for <b>.{doc.file_type}</b> files.
              </p>
              <a href={`/api/files/${doc.id}/original`}
                className="bg-slate-800 text-white rounded-lg px-4 py-2">
                ⬇ Download original
              </a>
            </div>
          )
        )}
      </article>

      <aside className="w-80 shrink-0 space-y-4">
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-sm space-y-1">
          <h3 className="font-semibold mb-2 text-slate-700">Metadata</h3>
          <p><span className="text-slate-500">Type:</span> {doc.file_type}</p>
          <p><span className="text-slate-500">Size:</span> {doc.size_bytes} bytes</p>
          <p><span className="text-slate-500">Status:</span> {doc.status}</p>
          <p><span className="text-slate-500">Added:</span> {doc.created_at}</p>
          {doc.markdown && (
            <p><span className="text-slate-500">Converter:</span> {doc.markdown.converter_used}
              {" · "}{doc.markdown.word_count} words</p>
          )}
          <p className="break-all"><span className="text-slate-500">SHA256:</span> {doc.sha256}</p>
          <h4 className="font-semibold pt-2 text-slate-700">Locations</h4>
          {doc.locations.map((l, i) => (
            <div key={i} className="flex items-start gap-2">
              <p className="break-all text-slate-600 flex-1">
                {l.root_folder}/{l.subfolder_path ? l.subfolder_path + "/" : ""}{l.filename}
              </p>
              <button onClick={() => reveal(i)} title="Reveal in Finder"
                className="border border-slate-300 rounded-md px-2 py-0.5 text-xs hover:bg-slate-100 shrink-0">
                📂 Open
              </button>
            </div>
          ))}
          <a href={`/api/files/${doc.id}/original`}
            className="inline-block mt-3 bg-slate-800 text-white rounded-lg px-3 py-1.5">
            ⬇ Download original
          </a>
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-sm">
          <h3 className="font-semibold mb-2 text-slate-700">Tags</h3>
          <div className="flex flex-wrap gap-1 mb-2">
            {doc.tags.map((t) => (
              <span key={t} className="bg-indigo-100 text-indigo-800 rounded-full px-2 py-0.5">
                #{t} <button onClick={() => removeTag(t)} className="text-indigo-400">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTag()}
              placeholder="add tag…" className="border border-slate-300 rounded-lg px-2 py-1 flex-1" />
            <button onClick={addTag}
              className="bg-indigo-600 text-white rounded-lg px-3">+</button>
          </div>
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-sm">
          <h3 className="font-semibold mb-2 text-slate-700">Notes</h3>
          {doc.notes.map((n) => (
            <div key={n.id} className="border-b border-slate-100 py-2">
              <p>{n.content}</p>
              <p className="text-xs text-slate-400">{n.created_at}</p>
            </div>
          ))}
          <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)}
            placeholder="add a note…" rows={3}
            className="border border-slate-300 rounded-lg w-full px-2 py-1 mt-2" />
          <button onClick={addNote}
            className="bg-indigo-600 text-white rounded-lg px-3 py-1 mt-1">Save note</button>
        </section>
      </aside>
    </div>
  );
}
