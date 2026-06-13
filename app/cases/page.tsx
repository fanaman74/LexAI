import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { NewCaseForm } from "./new-case-form";

export default async function CasesPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: cases } = await supabase
    .from("cases")
    .select("*, case_documents(count)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-xl font-semibold mb-6">Cases</h1>
      <NewCaseForm />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="pb-2">Name</th>
            <th className="pb-2">Description</th>
            <th className="pb-2">Status</th>
            <th className="pb-2">Docs</th>
            <th className="pb-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {(cases ?? []).map((c: any) => (
            <tr key={c.id} className="border-t hover:bg-gray-50">
              <td className="py-2 pr-4">
                <Link href={`/cases/${c.id}`} className="text-blue-600 hover:underline font-medium">
                  {c.name}
                </Link>
              </td>
              <td className="pr-4 text-gray-600">{c.description ?? "—"}</td>
              <td className="pr-4">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    c.status === "active"
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {c.status}
                </span>
              </td>
              <td className="pr-4">{(c.case_documents as any)?.[0]?.count ?? 0}</td>
              <td>{new Date(c.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
