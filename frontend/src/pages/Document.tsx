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
              converted_at: string; word_count: number;
              keywords: string[]; summary: string | null } | null;
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

  if (error) return <p className="text-red-400 p-6">{error}</p>;
  if (!doc) return <p className="text-zinc-400 p-6">Loading…</p>;

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

  async function summarise() {
    try {
      await api(`/api/files/${doc!.id}/summarise`, { method: "POST" });
      load();
    } catch (e) { setError((e as Error).message); }
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
    <div className="max-w-6xl mx-auto flex gap-6 p-6">
      <article className="flex-1 bg-zinc-900 rounded-xl border border-zinc-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-zinc-100">{doc.original_name}</h1>
          <div className="flex items-center gap-2">
            <Link to={`/chat?ids=${doc.id}`}
              className="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm hover:bg-emerald-700">
              💬 Chat
            </Link>
            <Link to="/docmgmt" className="text-amber-400 text-sm hover:underline">← DocMgmt</Link>
          </div>
        </div>

        <div className="flex gap-1 border-b border-zinc-800 mb-4">
          {(["md", "original"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg ${
                tab === t ? "bg-amber-500/10 text-amber-400 border border-b-0 border-zinc-800"
                  : "text-zinc-500 hover:text-zinc-300"}`}>
              {t === "md" ? "Markdown" : "Original"}
            </button>
          ))}
        </div>

        {tab === "md" && (
          doc.markdown ? (
            <div className="prose prose-invert max-w-none">
              <ReactMarkdown>{doc.markdown.content_md}</ReactMarkdown>
            </div>
          ) : (
            <div>
              <p className="text-amber-400">
                No converted text ({doc.status}
                {doc.error_message ? `: ${doc.error_message}` : ""}).
              </p>
              <button onClick={retry}
                className="mt-2 bg-amber-500 text-black rounded-lg px-3 py-1 text-sm font-medium">
                Retry conversion
              </button>
            </div>
          )
        )}

        {tab === "original" && (
          canInline ? (
            <iframe title="original"
              src={`/api/files/${doc.id}/original?inline=1`}
              className="w-full rounded-lg border border-zinc-700"
              style={{ height: "70vh" }} />
          ) : (
            <div className="text-center py-16 text-zinc-400">
              <p className="mb-3">
                No in-browser preview for <b>.{doc.file_type}</b> files.
              </p>
              <a href={`/api/files/${doc.id}/original`}
                className="bg-zinc-800 text-white rounded-lg px-4 py-2 hover:bg-zinc-700">
                ⬇ Download original
              </a>
            </div>
          )
        )}
      </article>

      <aside className="w-80 shrink-0 space-y-4">

        {/* AI Summary panel */}
        {doc.markdown && (
          <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-zinc-200">AI Summary</h3>
              <button onClick={summarise}
                className="text-xs text-amber-400 hover:text-amber-300 border border-amber-500/30 rounded-md px-2 py-0.5 hover:border-amber-500 transition-colors">
                {doc.markdown.keywords?.length ? "Regenerate" : "Generate"}
              </button>
            </div>
            {doc.markdown.keywords?.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">Keywords</p>
                <div className="flex flex-wrap gap-1">
                  {doc.markdown.keywords.map((kw) => (
                    <span key={kw} className="bg-blue-500/15 text-blue-400 text-xs rounded-full px-2 py-0.5">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {doc.markdown.summary ? (
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">Summary</p>
                <p className="text-zinc-300 text-xs leading-relaxed whitespace-pre-wrap">{doc.markdown.summary}</p>
              </div>
            ) : (
              <p className="text-zinc-600 text-xs">No summary yet — click Generate to create one using AI.</p>
            )}
          </section>
        )}

        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-sm space-y-1">
          <h3 className="font-semibold mb-2 text-zinc-200">Metadata</h3>
          <p><span className="text-zinc-400">Type:</span> <span className="text-zinc-300">{doc.file_type}</span></p>
          <p><span className="text-zinc-400">Size:</span> <span className="text-zinc-300">{doc.size_bytes} bytes</span></p>
          <p><span className="text-zinc-400">Status:</span> <span className="text-zinc-300">{doc.status}</span></p>
          <p><span className="text-zinc-400">Added:</span> <span className="text-zinc-300">{doc.created_at}</span></p>
          {doc.markdown && (
            <p><span className="text-zinc-400">Converter:</span> <span className="text-zinc-300">{doc.markdown.converter_used}
              {" · "}{doc.markdown.word_count} words</span></p>
          )}
          <p className="break-all"><span className="text-zinc-400">SHA256:</span> <span className="text-zinc-300">{doc.sha256}</span></p>
          <h4 className="font-semibold pt-2 text-zinc-200">Locations</h4>
          {doc.locations.map((l, i) => (
            <div key={i} className="flex items-start gap-2">
              <p className="break-all text-zinc-400 flex-1">
                {l.root_folder}/{l.subfolder_path ? l.subfolder_path + "/" : ""}{l.filename}
              </p>
              <button onClick={() => reveal(i)} title="Reveal in Finder"
                className="border border-zinc-700 text-zinc-300 rounded-md px-2 py-0.5 text-xs hover:bg-zinc-800 shrink-0">
                📂 Open
              </button>
            </div>
          ))}
          <a href={`/api/files/${doc.id}/original`}
            className="inline-block mt-3 bg-zinc-800 text-white rounded-lg px-3 py-1.5 hover:bg-zinc-700">
            ⬇ Download original
          </a>
        </section>

        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-sm">
          <h3 className="font-semibold mb-2 text-zinc-200">Tags</h3>
          <div className="flex flex-wrap gap-1 mb-2">
            {doc.tags.map((t) => (
              <span key={t} className="bg-amber-500/10 text-amber-400 rounded-full px-2 py-0.5">
                #{t} <button onClick={() => removeTag(t)} className="text-amber-400 hover:text-amber-300">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTag()}
              placeholder="add tag…"
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 flex-1 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500" />
            <button onClick={addTag}
              className="bg-amber-500 text-black rounded-lg px-3 font-bold hover:bg-amber-400">+</button>
          </div>
        </section>

        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-sm">
          <h3 className="font-semibold mb-2 text-zinc-200">Notes</h3>
          {doc.notes.map((n) => (
            <div key={n.id} className="border-b border-zinc-800/60 py-2">
              <p className="text-zinc-300">{n.content}</p>
              <p className="text-xs text-zinc-500">{n.created_at}</p>
            </div>
          ))}
          <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)}
            placeholder="add a note…" rows={3}
            className="bg-zinc-800 border border-zinc-700 rounded-lg w-full px-2 py-1 mt-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500" />
          <button onClick={addNote}
            className="bg-amber-500 text-black rounded-lg px-3 py-1 mt-1 font-medium hover:bg-amber-400">Save note</button>
        </section>
      </aside>
    </div>
  );
}
