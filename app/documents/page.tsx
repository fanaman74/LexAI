import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { UploadForm } from "./upload-form";

export default async function DocumentsPage() {
  await requireUser();
  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documents")
    .select("id, original_filename, source_type, processing_status, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Documents</h1>
        <form action={signOut}><button className="text-sm underline">Sign out</button></form>
      </div>
      <UploadForm />
      <table className="mt-6 w-full text-sm">
        <thead><tr className="text-left text-gray-500">
          <th>File</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>
          {(docs ?? []).map((d) => (
            <tr key={d.id} className="border-t">
              <td className="py-1">{d.original_filename}</td>
              <td>{d.source_type}</td>
              <td>{d.processing_status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
