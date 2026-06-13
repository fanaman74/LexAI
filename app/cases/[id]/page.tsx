import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CaseDocuments } from "./case-documents";

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: caseData } = await supabase
    .from("cases")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!caseData) notFound();

  const { data: caseDocRows } = await supabase
    .from("case_documents")
    .select("document_id")
    .eq("case_id", id)
    .eq("user_id", user.id);

  const caseDocIds = (caseDocRows ?? []).map((r: any) => r.document_id);

  const [{ data: documents }, { data: allUserDocs }] = await Promise.all([
    caseDocIds.length > 0
      ? supabase
          .from("documents")
          .select("id, original_filename, display_title, source_type, processing_status")
          .in("id", caseDocIds)
          .eq("user_id", user.id)
      : Promise.resolve({ data: [] as any[] }),
    supabase
      .from("documents")
      .select("id, original_filename, display_title, source_type, processing_status")
      .eq("user_id", user.id)
      .eq("processing_status", "processed")
      .order("original_filename")
      .limit(100),
  ]);

  const caseDocIdSet = new Set(caseDocIds);
  const availableDocs = (allUserDocs ?? []).filter((d: any) => !caseDocIdSet.has(d.id));

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6">
        <Link href="/cases" className="text-sm text-gray-500 hover:underline">
          ← Cases
        </Link>
      </div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{caseData.name}</h1>
          {caseData.description && (
            <p className="text-sm text-gray-600 mt-1">{caseData.description}</p>
          )}
          <span
            className={`mt-2 inline-block rounded px-2 py-0.5 text-xs ${
              caseData.status === "active"
                ? "bg-green-100 text-green-800"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {caseData.status}
          </span>
        </div>
        <div className="flex gap-2">
          <a
            href={`/search?case_id=${id}`}
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
          >
            Search this case
          </a>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          disabled
          className="rounded border px-3 py-1 text-xs text-gray-400 cursor-not-allowed"
        >
          Ask AI about this case (Phase 5)
        </button>
        <button
          disabled
          className="rounded border px-3 py-1 text-xs text-gray-400 cursor-not-allowed"
        >
          Export bundle (Phase 6)
        </button>
      </div>

      <CaseDocuments
        caseData={{
          id: caseData.id,
          name: caseData.name,
          status: caseData.status,
          description: caseData.description,
        }}
        documents={documents ?? []}
        availableDocs={availableDocs}
      />
    </main>
  );
}
