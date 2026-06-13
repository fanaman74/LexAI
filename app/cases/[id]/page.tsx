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
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: "20px" }}>
        <Link href="/cases" style={{ fontSize: "13px", color: "#9ca3af", textDecoration: "none" }}>
          ← Cases
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 600, color: "#ffffff", margin: 0 }}>{caseData.name}</h1>
          {caseData.description && (
            <p style={{ fontSize: "13px", color: "#9ca3af", marginTop: "6px" }}>{caseData.description}</p>
          )}
          <span
            style={{
              display: "inline-block",
              marginTop: "8px",
              borderRadius: "9999px",
              padding: "2px 10px",
              fontSize: "11px",
              fontWeight: 500,
              backgroundColor: caseData.status === "active" ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.08)",
              color: caseData.status === "active" ? "#22c55e" : "#9ca3af",
            }}
          >
            {caseData.status}
          </span>
        </div>
        <a
          href={`/search?case_id=${id}`}
          style={{
            padding: "8px 14px",
            fontSize: "13px",
            borderRadius: "6px",
            border: "1px solid #2a2a2a",
            color: "#9ca3af",
            backgroundColor: "#171717",
            textDecoration: "none",
          }}
        >
          Search this case
        </a>
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
