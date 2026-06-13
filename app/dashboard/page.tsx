import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

function StatusBadge({ status }: { status: string }) {
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
  return <span style={style}>{status}</span>;
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [
    { count: totalDocs },
    { count: processedDocs },
    { count: failedDocs },
    { count: inProgressDocs },
    { count: chunkedDocs },
    { count: totalCases },
    { data: recentUploads },
    { data: recentSearches },
  ] = await Promise.all([
    supabase.from("documents").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("documents").select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("processing_status", "processed"),
    supabase.from("documents").select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("processing_status", "failed"),
    supabase.from("documents").select("*", { count: "exact", head: true }).eq("user_id", user.id).in("processing_status", ["queued", "processing"]),
    supabase.from("documents").select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("chunking_status", "chunked"),
    supabase.from("cases").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("documents").select("id, original_filename, processing_status, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
    supabase.from("audit_log").select("id, action, metadata, created_at").eq("user_id", user.id).eq("action", "search").order("created_at", { ascending: false }).limit(5),
  ]);

  const stats = [
    { label: "Total Docs", value: totalDocs ?? 0, accent: false },
    { label: "Processed", value: processedDocs ?? 0, accent: true },
    { label: "Failed", value: failedDocs ?? 0, accent: false },
    { label: "In Progress", value: inProgressDocs ?? 0, accent: false },
    { label: "Indexed", value: chunkedDocs ?? 0, accent: true },
    { label: "Cases", value: totalCases ?? 0, accent: false },
  ];

  const cardStyle: React.CSSProperties = {
    backgroundColor: "#171717",
    border: "1px solid #2a2a2a",
    borderRadius: "8px",
    padding: "16px",
  };

  return (
    <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 600, color: "#ffffff", margin: 0 }}>Dashboard</h1>
        <p style={{ fontSize: "13px", color: "#9ca3af", marginTop: "4px" }}>Overview of your legal document library</p>
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "12px", marginBottom: "32px" }}>
        {stats.map((s) => (
          <div key={s.label} style={cardStyle}>
            <div style={{ fontSize: "28px", fontWeight: 700, color: s.accent ? "#f59e0b" : "#ffffff" }}>{s.value}</div>
            <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "32px" }}>
        <Link
          href="/documents"
          style={{
            padding: "8px 16px",
            fontSize: "13px",
            fontWeight: 600,
            borderRadius: "6px",
            backgroundColor: "#f59e0b",
            color: "#000",
            textDecoration: "none",
          }}
        >
          + Upload Document
        </Link>
        <Link
          href="/cases"
          style={{
            padding: "8px 16px",
            fontSize: "13px",
            borderRadius: "6px",
            backgroundColor: "#171717",
            border: "1px solid #2a2a2a",
            color: "#ffffff",
            textDecoration: "none",
          }}
        >
          View Cases
        </Link>
        <Link
          href="/search"
          style={{
            padding: "8px 16px",
            fontSize: "13px",
            borderRadius: "6px",
            backgroundColor: "#171717",
            border: "1px solid #2a2a2a",
            color: "#ffffff",
            textDecoration: "none",
          }}
        >
          Search
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        {/* Recent uploads */}
        <div style={cardStyle}>
          <h2 style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff", marginBottom: "16px" }}>Recent uploads</h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            {(recentUploads ?? []).map((doc) => (
              <li key={doc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <a
                  href={`/documents/${doc.id}`}
                  style={{ color: "#f59e0b", textDecoration: "none", fontSize: "13px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {doc.original_filename}
                </a>
                <StatusBadge status={doc.processing_status ?? "unknown"} />
                <span style={{ color: "#9ca3af", fontSize: "11px", flexShrink: 0 }}>{relativeDate(doc.created_at)}</span>
              </li>
            ))}
            {(recentUploads ?? []).length === 0 && (
              <li style={{ color: "#9ca3af", fontSize: "13px" }}>No documents yet</li>
            )}
          </ul>
        </div>

        {/* Recent searches */}
        <div style={cardStyle}>
          <h2 style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff", marginBottom: "16px" }}>Recent searches</h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            {(recentSearches ?? []).length === 0 && (
              <li style={{ color: "#9ca3af", fontSize: "13px" }}>No searches yet</li>
            )}
            {(recentSearches ?? []).map((row) => (
              <li key={row.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <span style={{ color: "#ffffff", fontSize: "13px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(row.metadata as any)?.query ?? "(no query)"}
                </span>
                <span style={{ color: "#9ca3af", fontSize: "11px" }}>{(row.metadata as any)?.mode ?? ""}</span>
                <span style={{ color: "#9ca3af", fontSize: "11px", flexShrink: 0 }}>{relativeDate(row.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
