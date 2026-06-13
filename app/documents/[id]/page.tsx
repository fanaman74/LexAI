import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DocumentActions } from "./actions";

function StatusBadge({ status }: { status: string | null }) {
  let cls = "rounded px-2 py-0.5 text-xs ";
  if (status === "processed") cls += "bg-green-100 text-green-800";
  else if (status === "failed") cls += "bg-red-100 text-red-800";
  else if (status === "queued" || status === "processing") cls += "bg-amber-100 text-amber-800";
  else cls += "bg-gray-100 text-gray-600";
  return <span className={cls}>{status ?? "unknown"}</span>;
}

function ChunkBadge({ status }: { status: string | null }) {
  if (!status) return null;
  let cls = "rounded px-2 py-0.5 text-xs ";
  if (status === "chunked") cls += "bg-blue-100 text-blue-800";
  else if (status === "chunking") cls += "bg-amber-100 text-amber-800";
  else if (status === "failed") cls += "bg-red-100 text-red-800";
  else return null;
  return <span className={cls}>{status}</span>;
}

function MetaField({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div>
      <span className="text-xs text-gray-500">{label}</span>
      <p className="mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!doc) notFound();

  const [{ data: children }, { data: parentDoc }, { data: chunks }] = await Promise.all([
    supabase.from("documents")
      .select("id, original_filename, source_type, processing_status")
      .eq("parent_document_id", id)
      .eq("user_id", user.id),
    doc.parent_document_id
      ? supabase.from("documents")
          .select("id, original_filename")
          .eq("id", doc.parent_document_id)
          .eq("user_id", user.id)
          .single()
      : Promise.resolve({ data: null }),
    supabase.from("document_chunks")
      .select("chunk_id, chunk_index, section_title, char_count")
      .eq("document_id", id)
      .order("chunk_index", { ascending: true })
      .limit(200),
  ]);

  const isEmail = ["eml", "msg"].includes(doc.source_type ?? "");

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6">
        <Link href="/documents" className="text-sm text-gray-500 hover:underline">← Documents</Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">{doc.display_title ?? doc.original_filename}</h1>
          <div className="mt-1 flex gap-2">
            <StatusBadge status={doc.processing_status} />
            {doc.chunking_status && <ChunkBadge status={doc.chunking_status} />}
          </div>
        </div>
        <DocumentActions
          documentId={id}
          hasMarkdown={!!doc.markdown_storage_path}
        />
      </div>

      {/* Metadata grid */}
      <section className="mb-6 rounded border p-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <MetaField label="Source type" value={doc.source_type} />
        <MetaField label="Document date" value={doc.document_date ?? "—"} />
        <MetaField label="Created" value={new Date(doc.created_at).toLocaleDateString()} />
        <MetaField label="File size" value={doc.file_size_bytes ? formatBytes(doc.file_size_bytes) : "—"} />
        <MetaField label="SHA256" value={doc.sha256_hash ? doc.sha256_hash.slice(0, 16) + "…" : "—"} />
        {doc.processing_error && (
          <div className="col-span-full">
            <span className="text-xs text-gray-500">Error</span>
            <p className="text-red-600 text-sm mt-1">{doc.processing_error}</p>
          </div>
        )}
      </section>

      {/* Email block */}
      {isEmail && (
        <section className="mb-6 rounded border p-4 text-sm">
          <h2 className="font-medium mb-2">Email</h2>
          <MetaField label="From" value={doc.sender ?? "—"} />
          <MetaField label="To" value={doc.recipients ? JSON.stringify(doc.recipients) : "—"} />
          <MetaField label="Subject" value={doc.email_subject ?? "—"} />
          <MetaField label="Date" value={doc.document_datetime ?? "—"} />
        </section>
      )}

      {/* AI block */}
      <section className="mb-6 rounded border p-4 text-sm">
        <h2 className="font-medium mb-2">AI Analysis</h2>
        {doc.ai_short_summary ? (
          <p className="mb-2">{doc.ai_short_summary}</p>
        ) : (
          <p className="text-gray-400 italic mb-2">Not analysed yet</p>
        )}
        <div className="flex flex-wrap gap-1 mb-3">
          {(doc.ai_keywords ?? []).map((kw: string) => (
            <span key={kw} className="rounded bg-gray-100 px-2 py-0.5 text-xs">{kw}</span>
          ))}
        </div>
        <button disabled className="rounded border px-3 py-1 text-xs text-gray-400 cursor-not-allowed">
          Ask AI (Phase 5)
        </button>
      </section>

      {/* Lineage */}
      {(parentDoc || (children && children.length > 0)) && (
        <section className="mb-6 rounded border p-4 text-sm">
          <h2 className="font-medium mb-2">Document lineage</h2>
          {parentDoc && (
            <p className="mb-1">Parent: <Link href={`/documents/${parentDoc.id}`} className="text-blue-600 hover:underline">{parentDoc.original_filename}</Link></p>
          )}
          {children && children.length > 0 && (
            <div>
              <p className="text-gray-500 mb-1">Attachments ({children.length}):</p>
              <ul className="space-y-0.5">
                {children.map((c: { id: string; original_filename: string; source_type: string | null; processing_status: string | null }) => (
                  <li key={c.id}>
                    <Link href={`/documents/${c.id}`} className="text-blue-600 hover:underline">{c.original_filename}</Link>
                    {" "}<span className="text-gray-400 text-xs">{c.source_type} · {c.processing_status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Markdown preview */}
      {doc.markdown_text && (
        <section className="mb-6 rounded border p-4">
          <h2 className="font-medium mb-2 text-sm">Markdown preview</h2>
          <pre className="whitespace-pre-wrap text-xs text-gray-700 max-h-96 overflow-y-auto">{doc.markdown_text}</pre>
        </section>
      )}

      {/* Chunks */}
      {chunks && chunks.length > 0 && (
        <section className="mb-6 rounded border p-4">
          <h2 className="font-medium mb-2 text-sm">Chunks ({chunks.length}{chunks.length === 200 ? "+" : ""})</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pb-1">#</th>
                <th className="pb-1">Chunk ID</th>
                <th className="pb-1">Section</th>
                <th className="pb-1">Chars</th>
              </tr>
            </thead>
            <tbody>
              {chunks.map((c: { chunk_id: string | null; chunk_index: number | null; section_title: string | null; char_count: number | null }) => (
                <tr key={c.chunk_id} className="border-t">
                  <td className="py-0.5 pr-2">{c.chunk_index}</td>
                  <td className="py-0.5 pr-2 font-mono">{c.chunk_id ? c.chunk_id.slice(0, 30) + "…" : "—"}</td>
                  <td className="py-0.5 pr-2">{c.section_title ?? "—"}</td>
                  <td className="py-0.5">{c.char_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
