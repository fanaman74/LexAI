import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { GraphPreview, GraphSyncResult } from "../api";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border border-zinc-800 bg-zinc-950 rounded-lg p-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="border border-dashed border-zinc-800 rounded-lg p-6 text-sm text-zinc-500">
      {text}
    </div>
  );
}

function graphNodeTarget(label: string): string {
  if (label === "Case") return "/cases";
  if (label === "Keyword") return "/search";
  if (label === "Chunk") return "/search";
  return "/docmgmt";
}

function graphEntityTarget(label: string, id: number | null): string | null {
  if (label === "Document" && id != null) return `/files/${id}`;
  if (label === "Case" && id != null) return `/cases?case_id=${id}`;
  return null;
}

function graphChatTarget(label: string, id: number | null): string | null {
  if (label === "Document" && id != null) return `/chat?ids=${id}&source=graph`;
  return null;
}

function graphChatTargetFromIds(ids: number[]): string | null {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  if (uniqueIds.length === 0) return null;
  return `/chat?ids=${uniqueIds.join(",")}&source=graph`;
}

function RelationshipEndpoint({
  label,
  id,
  name,
  tone,
  chatDocumentIds,
}: {
  label: string;
  id: number | null;
  name: string;
  tone: "primary" | "secondary";
  chatDocumentIds?: number[];
}) {
  const target = graphEntityTarget(label, id);
  const chatTarget = graphChatTargetFromIds(chatDocumentIds ?? []) ?? graphChatTarget(label, id);
  const className = tone === "primary"
    ? "text-sm text-zinc-300 mt-1 truncate hover:text-amber-300 transition-colors"
    : "text-xs text-zinc-600 mt-1 truncate hover:text-zinc-400 transition-colors";

  return (
    <div className="mt-1">
      {target ? (
        <Link to={target} className={`block ${className}`}>{name}</Link>
      ) : (
        <p className={className}>{name}</p>
      )}
      {chatTarget && tone === "primary" && (
        <Link
          to={chatTarget}
          className="inline-flex mt-1 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          {(chatDocumentIds?.length ?? 0) > 1 ? "Chat this relationship" : "Chat with this document"}
        </Link>
      )}
    </div>
  );
}

export default function GraphRAG() {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<GraphPreview | null>(null);
  const [syncResult, setSyncResult] = useState<GraphSyncResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setPreview(await api<GraphPreview>("/api/graph/preview"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function sync() {
    setSyncing(true);
    setError("");
    setSyncResult(null);
    try {
      const res = await api<GraphSyncResult>("/api/graph/sync", { method: "POST" });
      setSyncResult(res);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const graphRows = useMemo(() => {
    if (!preview) return [];
    return [
      { label: "Document", value: preview.counts.documents },
      { label: "Chunk", value: preview.counts.chunks },
      { label: "Case", value: preview.counts.cases },
      { label: "Keyword", value: preview.counts.keywords },
      { label: "Attachment", value: preview.counts.attachments },
    ];
  }, [preview]);

  if (loading && !preview) {
    return (
      <div className="p-8 text-zinc-500">Loading graph preview…</div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">GraphRAG</h1>
          <p className="text-sm text-zinc-500 mt-2 max-w-2xl">
            Export converted documents, chunks, cases, attachments, and keywords into Neo4j so searches can expand through legal relationships.
          </p>
        </div>
        <button
          onClick={sync}
          disabled={syncing || !preview?.configured}
          className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-black rounded-lg px-4 py-2 font-medium transition-colors"
        >
          {syncing ? "Syncing…" : "Sync to Neo4j"}
        </button>
      </div>

      {error && (
        <div className="border border-red-900 bg-red-950/40 text-red-300 rounded-lg p-4 text-sm">
          {error}
        </div>
      )}

      {preview && !preview.configured && (
        <div className="border border-amber-500/30 bg-amber-500/10 rounded-lg p-4 text-sm text-amber-200">
          Neo4j is not configured. Add <code className="text-amber-100">NEO4J_URI</code>, <code className="text-amber-100">NEO4J_USER</code>, and <code className="text-amber-100">NEO4J_PASSWORD</code> to enable sync. Preview data is still shown below.
        </div>
      )}

      {syncResult && (
        <div className="border border-emerald-700 bg-emerald-950/40 text-emerald-300 rounded-lg p-4 text-sm">
          Synced {fmt(syncResult.nodes)} nodes and {fmt(syncResult.relationships)} relationships to {syncResult.database}.
        </div>
      )}

      {preview && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {graphRows.map((row) => (
              <Stat key={row.label} label={row.label} value={fmt(row.value)} />
            ))}
          </div>

          <section className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-4">
            <div className="border border-zinc-800 bg-zinc-950 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide">Graph Model</h2>
                <span className="text-xs text-zinc-600">Postgres to Neo4j</span>
              </div>
              <div className="relative min-h-[320px] overflow-hidden rounded-lg border border-zinc-900 bg-black">
                <svg viewBox="0 0 680 320" className="absolute inset-0 w-full h-full">
                  <g stroke="#3f3f46" strokeWidth="1.5">
                    <line x1="134" y1="70" x2="310" y2="160" />
                    <line x1="134" y1="250" x2="310" y2="160" />
                    <line x1="310" y1="160" x2="516" y2="74" />
                    <line x1="310" y1="160" x2="516" y2="246" />
                    <line x1="516" y1="74" x2="516" y2="246" />
                  </g>
                  {[
                    { x: 134, y: 70, label: "Case", count: preview.counts.cases },
                    { x: 134, y: 250, label: "Keyword", count: preview.counts.keywords },
                    { x: 310, y: 160, label: "Document", count: preview.counts.documents },
                    { x: 516, y: 74, label: "Attachment", count: preview.counts.attachments },
                    { x: 516, y: 246, label: "Chunk", count: preview.counts.chunks },
                  ].map((node) => (
                    <g
                      key={node.label}
                      className="cursor-pointer"
                      onClick={() => navigate(graphNodeTarget(node.label))}
                    >
                      <circle cx={node.x} cy={node.y} r="52" fill="#18181b" stroke="#f59e0b" strokeWidth="1.5" />
                      <text x={node.x} y={node.y - 4} textAnchor="middle" fill="#f4f4f5" fontSize="14" fontWeight="700">{node.label}</text>
                      <text x={node.x} y={node.y + 18} textAnchor="middle" fill="#a1a1aa" fontSize="13">{fmt(node.count)}</text>
                    </g>
                  ))}
                </svg>
              </div>
            </div>

            <div className="border border-zinc-800 bg-zinc-950 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide mb-4">Relationships</h2>
              {preview.relationships.length === 0 ? (
                <Empty text="No case or attachment relationships are available yet." />
              ) : (
                <div className="space-y-2">
                  {preview.relationships.map((rel, i) => (
                    <div key={`${rel.type}-${i}`} className="border border-zinc-900 rounded-lg p-3">
                      <p className="text-xs text-amber-400 font-semibold">{rel.type}</p>
                      <RelationshipEndpoint
                        label={rel.source_label}
                        id={rel.source_id}
                        name={rel.source}
                        tone="primary"
                        chatDocumentIds={rel.chat_document_ids}
                      />
                      <RelationshipEndpoint
                        label={rel.target_label}
                        id={rel.target_id}
                        name={rel.target}
                        tone="secondary"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 bg-zinc-950 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide mb-4">Documents</h2>
              {preview.documents.length === 0 ? (
                <Empty text="Upload and process documents to populate the graph." />
              ) : (
                <div className="divide-y divide-zinc-900">
                  {preview.documents.map((doc) => (
                    <div key={doc.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                        <span className="text-[11px] bg-zinc-900 text-zinc-500 rounded px-1.5 py-0.5 uppercase">{doc.file_type}</span>
                        <Link to={`/files/${doc.id}`} className="text-sm text-zinc-200 truncate hover:text-amber-300 transition-colors">
                          {doc.original_filename}
                        </Link>
                        </div>
                        <p className="text-xs text-zinc-600 mt-1">
                          {doc.processing_status}{doc.parent_document_id ? ` · attachment of document ${doc.parent_document_id}` : ""}
                        </p>
                      </div>
                      <Link
                        to={`/chat?ids=${doc.id}`}
                        className="shrink-0 text-xs bg-emerald-600 text-white rounded-lg px-2.5 py-1 hover:bg-emerald-700 transition-colors"
                      >
                        Chat
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-zinc-800 bg-zinc-950 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide mb-4">Cases</h2>
              {preview.cases.length === 0 ? (
                <Empty text="Cases linked to documents will appear here." />
              ) : (
                <div className="divide-y divide-zinc-900">
                  {preview.cases.map((c) => (
                    <div key={c.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link to={`/cases?case_id=${c.id}`} className="text-sm text-zinc-200 truncate hover:text-amber-300 transition-colors">
                          {c.name}
                        </Link>
                        {c.document_ids.length > 0 && (
                          <Link
                            to={graphChatTargetFromIds(c.document_ids) ?? "#"}
                            className="block mt-1 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
                          >
                            Chat case documents
                          </Link>
                        )}
                      </div>
                      <span className="text-xs text-zinc-500 shrink-0">{c.document_count} documents</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
