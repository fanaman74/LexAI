import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DocumentActions } from "./actions";

function StatusBadge({ status }: { status: string | null }) {
  let style: React.CSSProperties = {
    borderRadius: "9999px",
    padding: "2px 8px",
    fontSize: "11px",
    fontWeight: 500,
  };
  if (status === "processed") {
    style = { ...style, backgroundColor: "rgba(34,197,94,0.15)", color: "#22c55e" };
  } else if (status === "failed") {
    style = { ...style, backgroundColor: "rgba(239,68,68,0.15)", color: "#ef4444" };
  } else {
    style = { ...style, backgroundColor: "rgba(245,158,11,0.15)", color: "#f59e0b" };
  }
  return <span style={style}>{status ?? "unknown"}</span>;
}

function ChunkBadge({ status }: { status: string | null }) {
  if (!status) return null;
  let style: React.CSSProperties = {
    borderRadius: "9999px",
    padding: "2px 8px",
    fontSize: "11px",
    fontWeight: 500,
  };
  if (status === "chunked") {
    style = { ...style, backgroundColor: "rgba(59,130,246,0.15)", color: "#60a5fa" };
  } else if (status === "chunking") {
    style = { ...style, backgroundColor: "rgba(245,158,11,0.15)", color: "#f59e0b" };
  } else if (status === "failed") {
    style = { ...style, backgroundColor: "rgba(239,68,68,0.15)", color: "#ef4444" };
  } else return null;
  return <span style={style}>{status}</span>;
}

function MetaField({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div>
      <span style={{ fontSize: "11px", color: "#9ca3af" }}>{label}</span>
      <p style={{ margin: "2px 0 0", color: "#ffffff", fontSize: "13px" }}>{value ?? "—"}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

const sectionStyle: React.CSSProperties = {
  backgroundColor: "#171717",
  border: "1px solid #2a2a2a",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "16px",
};

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
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: "20px" }}>
        <Link href="/documents" style={{ fontSize: "13px", color: "#9ca3af", textDecoration: "none" }}>
          ← Library
        </Link>
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 600, color: "#ffffff", margin: 0 }}>
            {doc.display_title ?? doc.original_filename}
          </h1>
          <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
            <StatusBadge status={doc.processing_status} />
            {doc.chunking_status && <ChunkBadge status={doc.chunking_status} />}
          </div>
        </div>
        <DocumentActions documentId={id} hasMarkdown={!!doc.markdown_storage_path} />
      </div>

      {/* Metadata */}
      <div style={{ ...sectionStyle, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        <MetaField label="Source type" value={doc.source_type} />
        <MetaField label="Document date" value={doc.document_date ?? "—"} />
        <MetaField label="Created" value={new Date(doc.created_at).toLocaleDateString()} />
        <MetaField label="File size" value={doc.file_size_bytes ? formatBytes(doc.file_size_bytes) : "—"} />
        <MetaField label="SHA256" value={doc.sha256_hash ? doc.sha256_hash.slice(0, 16) + "…" : "—"} />
        {doc.processing_error && (
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={{ fontSize: "11px", color: "#9ca3af" }}>Error</span>
            <p style={{ color: "#ef4444", fontSize: "13px", marginTop: "2px" }}>{doc.processing_error}</p>
          </div>
        )}
      </div>

      {/* Email */}
      {isEmail && (
        <div style={{ ...sectionStyle, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <h2 style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff", margin: 0, gridColumn: "1 / -1" }}>Email details</h2>
          <MetaField label="From" value={doc.sender ?? "—"} />
          <MetaField label="To" value={doc.recipients ? JSON.stringify(doc.recipients) : "—"} />
          <MetaField label="Subject" value={doc.email_subject ?? "—"} />
          <MetaField label="Date" value={doc.document_datetime ?? "—"} />
        </div>
      )}

      {/* AI */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff", margin: "0 0 10px" }}>AI Analysis</h2>
        {doc.ai_short_summary ? (
          <p style={{ fontSize: "13px", color: "#ffffff", margin: "0 0 10px" }}>{doc.ai_short_summary}</p>
        ) : (
          <p style={{ fontSize: "13px", color: "#6b7280", fontStyle: "italic", margin: "0 0 10px" }}>Not analysed yet</p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
          {(doc.ai_keywords ?? []).map((kw: string) => (
            <span
              key={kw}
              style={{
                borderRadius: "9999px",
                padding: "2px 8px",
                fontSize: "11px",
                backgroundColor: "rgba(245,158,11,0.1)",
                color: "#f59e0b",
                border: "1px solid rgba(245,158,11,0.2)",
              }}
            >
              {kw}
            </span>
          ))}
        </div>
      </div>

      {/* Lineage */}
      {(parentDoc || (children && children.length > 0)) && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff", margin: "0 0 10px" }}>Document lineage</h2>
          {parentDoc && (
            <p style={{ fontSize: "13px", marginBottom: "8px", color: "#9ca3af" }}>
              Parent:{" "}
              <Link href={`/documents/${parentDoc.id}`} style={{ color: "#f59e0b", textDecoration: "none" }}>
                {parentDoc.original_filename}
              </Link>
            </p>
          )}
          {children && children.length > 0 && (
            <div>
              <p style={{ color: "#9ca3af", fontSize: "12px", marginBottom: "6px" }}>
                Attachments ({children.length}):
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                {children.map((c: { id: string; original_filename: string; source_type: string | null; processing_status: string | null }) => (
                  <li key={c.id} style={{ fontSize: "13px" }}>
                    <Link href={`/documents/${c.id}`} style={{ color: "#f59e0b", textDecoration: "none" }}>
                      {c.original_filename}
                    </Link>
                    {" "}
                    <span style={{ color: "#9ca3af", fontSize: "11px" }}>{c.source_type} · {c.processing_status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Markdown */}
      {doc.markdown_text && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff", margin: "0 0 10px" }}>Markdown preview</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "12px", color: "#9ca3af", maxHeight: "384px", overflowY: "auto", margin: 0 }}>
            {doc.markdown_text}
          </pre>
        </div>
      )}

      {/* Chunks */}
      {chunks && chunks.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff", margin: "0 0 10px" }}>
            Chunks ({chunks.length}{chunks.length === 200 ? "+" : ""})
          </h2>
          <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#9ca3af", textAlign: "left", borderBottom: "1px solid #2a2a2a" }}>
                <th style={{ paddingBottom: "6px" }}>#</th>
                <th style={{ paddingBottom: "6px" }}>Chunk ID</th>
                <th style={{ paddingBottom: "6px" }}>Section</th>
                <th style={{ paddingBottom: "6px" }}>Chars</th>
              </tr>
            </thead>
            <tbody>
              {chunks.map((c: { chunk_id: string | null; chunk_index: number | null; section_title: string | null; char_count: number | null }) => (
                <tr key={c.chunk_id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                  <td style={{ padding: "4px 8px 4px 0", color: "#9ca3af" }}>{c.chunk_index}</td>
                  <td style={{ padding: "4px 8px 4px 0", fontFamily: "monospace", color: "#9ca3af" }}>
                    {c.chunk_id ? c.chunk_id.slice(0, 30) + "…" : "—"}
                  </td>
                  <td style={{ padding: "4px 8px 4px 0", color: "#ffffff" }}>{c.section_title ?? "—"}</td>
                  <td style={{ color: "#9ca3af" }}>{c.char_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
