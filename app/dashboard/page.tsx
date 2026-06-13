import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

function StatusBadge({ status }: { status: string }) {
  let cls = "rounded px-2 py-0.5 text-xs ";
  if (status === "processed") cls += "bg-green-100 text-green-800";
  else if (status === "failed") cls += "bg-red-100 text-red-800";
  else if (status === "processing" || status === "queued")
    cls += "bg-amber-100 text-amber-800";
  else cls += "bg-gray-100 text-gray-700";
  return <span className={cls}>{status}</span>;
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
    supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("processing_status", "processed"),
    supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("processing_status", "failed"),
    supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("processing_status", ["queued", "processing"]),
    supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("chunking_status", "chunked"),
    supabase
      .from("cases")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("documents")
      .select("id, original_filename, processing_status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("audit_log")
      .select("id, action, metadata, created_at")
      .eq("user_id", user.id)
      .eq("action", "search")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const stats = [
    { label: "Total Docs", value: totalDocs ?? 0 },
    { label: "Processed", value: processedDocs ?? 0 },
    { label: "Failed", value: failedDocs ?? 0 },
    { label: "In Progress", value: inProgressDocs ?? 0 },
    { label: "Chunked", value: chunkedDocs ?? 0 },
    { label: "Cases", value: totalCases ?? 0 },
  ];

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-xl font-semibold mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="rounded border p-4">
            <div className="text-3xl font-bold">{s.value}</div>
            <div className="text-sm text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Recent uploads */}
        <div>
          <h2 className="text-sm font-semibold mb-3">Recent uploads</h2>
          <ul className="space-y-2 text-sm">
            {(recentUploads ?? []).map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-2">
                <a
                  href={`/documents/${doc.id}`}
                  className="truncate text-blue-600 hover:underline flex-1"
                >
                  {doc.original_filename}
                </a>
                <StatusBadge status={doc.processing_status ?? "unknown"} />
                <span className="text-gray-400 text-xs shrink-0">
                  {relativeDate(doc.created_at)}
                </span>
              </li>
            ))}
            {(recentUploads ?? []).length === 0 && (
              <li className="text-gray-400">No documents yet</li>
            )}
          </ul>
        </div>

        {/* Recent searches */}
        <div>
          <h2 className="text-sm font-semibold mb-3">Recent searches</h2>
          <ul className="space-y-2 text-sm">
            {(recentSearches ?? []).length === 0 && (
              <li className="text-gray-400">No searches yet</li>
            )}
            {(recentSearches ?? []).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span className="truncate flex-1">
                  {(row.metadata as any)?.query ?? "(no query)"}
                </span>
                <span className="text-gray-400 text-xs shrink-0">
                  {(row.metadata as any)?.mode ?? ""}
                </span>
                <span className="text-gray-400 text-xs shrink-0">
                  {relativeDate(row.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
