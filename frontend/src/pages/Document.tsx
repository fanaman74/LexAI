import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import type { FileLocation } from "../api";

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
  const [newTag, setNewTag] = useState("");
  const [newNote, setNewNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setDoc(await api<Detail>(`/api/files/${id}`)); }
    catch (e) { setError((e as Error).message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!doc) return <p>Loading…</p>;

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

  return (
    <div className="flex gap-6">
      <article className="flex-1 bg-white rounded-md shadow p-6 prose max-w-none">
        <div className="flex items-center justify-between mb-4 not-prose">
          <h1 className="text-xl font-bold">{doc.original_name}</h1>
          <Link to="/" className="text-blue-700 text-sm hover:underline">← Library</Link>
        </div>
        {doc.markdown ? (
          <ReactMarkdown>{doc.markdown.content_md}</ReactMarkdown>
        ) : (
          <div className="not-prose">
            <p className="text-amber-700">
              No converted text ({doc.status}
              {doc.error_message ? `: ${doc.error_message}` : ""}).
            </p>
            <button onClick={retry}
              className="mt-2 bg-blue-600 text-white rounded-md px-3 py-1 text-sm">
              Retry conversion
            </button>
          </div>
        )}
      </article>

      <aside className="w-80 shrink-0 space-y-4">
        <section className="bg-white rounded-md shadow p-4 text-sm space-y-1">
          <h3 className="font-semibold mb-2">Metadata</h3>
          <p><span className="text-slate-500">Type:</span> {doc.file_type}</p>
          <p><span className="text-slate-500">Size:</span> {doc.size_bytes} bytes</p>
          <p><span className="text-slate-500">Status:</span> {doc.status}</p>
          <p><span className="text-slate-500">Added:</span> {doc.created_at}</p>
          {doc.markdown && (
            <p><span className="text-slate-500">Converter:</span> {doc.markdown.converter_used}
              {" · "}{doc.markdown.word_count} words</p>
          )}
          <p className="break-all"><span className="text-slate-500">SHA256:</span> {doc.sha256}</p>
          <h4 className="font-semibold pt-2">Locations</h4>
          {doc.locations.map((l, i) => (
            <p key={i} className="break-all text-slate-700">
              {l.root_folder}/{l.subfolder_path ? l.subfolder_path + "/" : ""}{l.filename}
            </p>
          ))}
          <a href={`/api/files/${doc.id}/original`}
            className="inline-block mt-3 bg-slate-800 text-white rounded-md px-3 py-1.5">
            ⬇ Download original
          </a>
        </section>

        <section className="bg-white rounded-md shadow p-4 text-sm">
          <h3 className="font-semibold mb-2">Tags</h3>
          <div className="flex flex-wrap gap-1 mb-2">
            {doc.tags.map((t) => (
              <span key={t} className="bg-blue-100 text-blue-800 rounded-full px-2 py-0.5">
                #{t} <button onClick={() => removeTag(t)} className="text-blue-500">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTag()}
              placeholder="add tag…" className="border rounded px-2 py-1 flex-1" />
            <button onClick={addTag} className="bg-blue-600 text-white rounded px-3">+</button>
          </div>
        </section>

        <section className="bg-white rounded-md shadow p-4 text-sm">
          <h3 className="font-semibold mb-2">Notes</h3>
          {doc.notes.map((n) => (
            <div key={n.id} className="border-b py-2">
              <p>{n.content}</p>
              <p className="text-xs text-slate-400">{n.created_at}</p>
            </div>
          ))}
          <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)}
            placeholder="add a note…" rows={3}
            className="border rounded w-full px-2 py-1 mt-2" />
          <button onClick={addNote}
            className="bg-blue-600 text-white rounded px-3 py-1 mt-1">Save note</button>
        </section>
      </aside>
    </div>
  );
}
