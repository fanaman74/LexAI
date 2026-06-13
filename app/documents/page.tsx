import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./upload-form";
import { Filters } from "./filters";
import Link from "next/link";

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

  let query = supabase
    .from("documents")
    .select("id, original_filename, display_title, source_type, processing_status, chunking_status, document_date, created_at, file_size_bytes", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (source_type) query = query.eq("source_type", source_type);
  if (processing_status) query = query.eq("processing_status", processing_status);
  if (q) query = query.ilike("original_filename", `%${q}%`);

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
      return (
        <main className="mx-auto max-w-5xl p-8">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-semibold">Documents</h1>
            <span className="text-sm text-gray-500">0 total</span>
          </div>
          <UploadForm />
          <Filters cases={cases ?? []} sourceTypes={["pdf", "docx", "xlsx", "eml", "msg", "email_attachment"]} />
          <p className="mt-6 text-sm text-gray-500">No documents in this case.</p>
        </main>
      );
    }
    query = query.in("id", ids);
  }

  const { data: docs, count } = await query;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Documents</h1>
        <span className="text-sm text-gray-500">{count ?? 0} total</span>
      </div>
      <UploadForm />
      <Filters cases={cases ?? []} sourceTypes={["pdf", "docx", "xlsx", "eml", "msg", "email_attachment"]} />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="pb-2">File</th>
            <th className="pb-2">Type</th>
            <th className="pb-2">Status</th>
            <th className="pb-2">Chunks</th>
            <th className="pb-2">Date</th>
            <th className="pb-2">Size</th>
          </tr>
        </thead>
        <tbody>
          {(docs ?? []).map((d) => (
            <tr key={d.id} className="border-t hover:bg-gray-50">
              <td className="py-2 pr-4">
                <Link href={`/documents/${d.id}`} className="hover:underline text-blue-600">
                  {(d as { display_title?: string | null }).display_title ?? d.original_filename}
                </Link>
              </td>
              <td className="pr-4">{d.source_type}</td>
              <td className="pr-4"><StatusBadge status={d.processing_status} /></td>
              <td className="pr-4"><ChunkBadge status={(d as { chunking_status?: string | null }).chunking_status ?? null} /></td>
              <td className="pr-4">{(d as { document_date?: string | null }).document_date ?? "—"}</td>
              <td>{(d as { file_size_bytes?: number | null }).file_size_bytes ? formatBytes((d as { file_size_bytes: number }).file_size_bytes) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
