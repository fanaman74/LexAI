import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./upload-form";
import { Filters } from "./filters";
import Link from "next/link";

function StatusBadge({ status }: { status: string | null }) {
  let style: React.CSSProperties = {
    borderRadius: "9999px",
    padding: "2px 8px",
    fontSize: "11px",
    fontWeight: 500,
  };
  if (status === "processed" || status === "converted") {
    style = { ...style, backgroundColor: "rgba(34,197,94,0.15)", color: "#22c55e" };
  } else if (status === "failed") {
    style = { ...style, backgroundColor: "rgba(239,68,68,0.15)", color: "#ef4444" };
  } else {
    style = { ...style, backgroundColor: "rgba(245,158,11,0.15)", color: "#f59e0b" };
  }
  return <span style={style}>{status ?? "unknown"}</span>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();

  const source_type = typeof sp.source_type === "string" ? sp.source_type : undefined;
  const processing_status = typeof sp.processing_status === "string" ? sp.processing_status : undefined;
  const case_id = typeof sp.case_id === "string" ? sp.case_id : undefined;
  const q = typeof sp.q === "string" ? sp.q : undefined;

  let docQuery = supabase
    .from("documents")
    .select("id, original_filename, display_title, source_type, processing_status, chunking_status, document_date, created_at, file_size_bytes", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (source_type) docQuery = docQuery.eq("source_type", source_type);
  if (processing_status) docQuery = docQuery.eq("processing_status", processing_status);
  if (q) docQuery = docQuery.ilike("original_filename", `%${q}%`);

  const { data: cases } = await supabase
    .from("cases")
    .select("id, name")
    .eq("user_id", user.id)
    .order("name");

  if (case_id) {
    const { data: cds } = await supabase
      .from("case_documents")
      .select("document_id")
      .eq("case_id", case_id)
      .eq("user_id", user.id);
    const ids = (cds ?? []).map((r: { document_id: string }) => r.document_id);
    if (ids.length === 0) {
      return renderPage(user, [], 0, cases ?? [], q);
    }
    docQuery = docQuery.in("id", ids);
  }

  const { data: docs, count } = await docQuery;
  return renderPage(user, docs ?? [], count ?? 0, cases ?? [], q);
}

function renderPage(
  _user: { id: string },
  docs: any[],
  count: number,
  cases: { id: string; name: string }[],
  q?: string,
) {
  const sourceTypes = ["pdf", "docx", "doc", "msg", "eml", "xlsx", "csv", "txt"];

  return (
    <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "32px 24px" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
        <UploadForm />
        <button
          disabled
          style={{
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: 500,
            borderRadius: "6px",
            border: "1px solid #f59e0b",
            color: "#f59e0b",
            background: "transparent",
            cursor: "not-allowed",
            opacity: 0.6,
          }}
        >
          ⚡ Index for semantic search
        </button>
        <button
          disabled
          style={{
            padding: "8px 14px",
            fontSize: "13px",
            borderRadius: "6px",
            border: "1px solid #2a2a2a",
            color: "#9ca3af",
            background: "transparent",
            cursor: "not-allowed",
            opacity: 0.6,
          }}
        >
          Clear all docs
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <Link
            href="/cases"
            style={{
              padding: "8px 14px",
              fontSize: "13px",
              borderRadius: "6px",
              border: "1px solid #2a2a2a",
              color: "#9ca3af",
              background: "#171717",
              textDecoration: "none",
            }}
          >
            Cases ({cases.length})
          </Link>
        </div>
      </div>

      {/* Search row */}
      <form method="GET" style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
        <input
          name="q"
          type="text"
          defaultValue={q ?? ""}
          placeholder="Search filename..."
          style={{
            flex: 1,
            padding: "8px 12px",
            fontSize: "13px",
            borderRadius: "6px",
            border: "1px solid #2a2a2a",
            background: "#171717",
            color: "#ffffff",
            outline: "none",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "8px 16px",
            fontSize: "13px",
            borderRadius: "6px",
            background: "#f59e0b",
            color: "#000",
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
          }}
        >
          Search
        </button>
      </form>

      {/* Divider */}
      <div style={{ borderTop: "1px solid #2a2a2a", marginBottom: "16px" }} />

      {/* Filters */}
      <Filters cases={cases} sourceTypes={sourceTypes} />

      {/* Divider */}
      <div style={{ borderTop: "1px solid #2a2a2a", margin: "16px 0" }} />

      {/* Count */}
      <div style={{ color: "#9ca3af", fontSize: "12px", marginBottom: "12px" }}>
        {count} document{count !== 1 ? "s" : ""}
      </div>

      {/* Table */}
      <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #2a2a2a", color: "#9ca3af", textAlign: "left" }}>
            <th style={{ paddingBottom: "10px", fontWeight: 500 }}>Name</th>
            <th style={{ paddingBottom: "10px", fontWeight: 500 }}>Type</th>
            <th style={{ paddingBottom: "10px", fontWeight: 500 }}>Size</th>
            <th style={{ paddingBottom: "10px", fontWeight: 500 }}>Status</th>
            <th style={{ paddingBottom: "10px", fontWeight: 500 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr
              key={d.id}
              style={{ borderBottom: "1px solid #2a2a2a" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1f1f1f")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <td style={{ padding: "10px 12px 10px 0", maxWidth: "360px" }}>
                <Link
                  href={`/documents/${d.id}`}
                  style={{ color: "#f59e0b", textDecoration: "none", wordBreak: "break-word" }}
                >
                  {d.display_title ?? d.original_filename}
                </Link>
              </td>
              <td style={{ padding: "10px 12px 10px 0", color: "#9ca3af" }}>{d.source_type}</td>
              <td style={{ padding: "10px 12px 10px 0", color: "#9ca3af" }}>
                {d.file_size_bytes ? formatBytes(d.file_size_bytes) : "—"}
              </td>
              <td style={{ padding: "10px 12px 10px 0" }}>
                <StatusBadge status={d.processing_status} />
              </td>
              <td style={{ padding: "10px 0" }}>
                <Link
                  href={`/documents/${d.id}`}
                  style={{ color: "#9ca3af", textDecoration: "none", fontSize: "12px" }}
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
          {docs.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: "32px 0", color: "#9ca3af", textAlign: "center" }}>
                No documents found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
