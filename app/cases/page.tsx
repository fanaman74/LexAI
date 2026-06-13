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
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 600, color: "#ffffff", margin: 0 }}>Cases</h1>
        <p style={{ fontSize: "13px", color: "#9ca3af", marginTop: "4px" }}>{cases?.length ?? 0} case{(cases?.length ?? 0) !== 1 ? "s" : ""}</p>
      </div>

      <NewCaseForm />

      <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse", marginTop: "24px" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #2a2a2a", color: "#9ca3af", textAlign: "left" }}>
            <th style={{ paddingBottom: "10px", fontWeight: 500 }}>Name</th>
            <th style={{ paddingBottom: "10px", fontWeight: 500 }}>Description</th>
            <th style={{ paddingBottom: "10px", fontWeight: 500 }}>Status</th>
            <th style={{ paddingBottom: "10px", fontWeight: 500 }}>Docs</th>
            <th style={{ paddingBottom: "10px", fontWeight: 500 }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {(cases ?? []).map((c: any) => (
            <tr
              key={c.id}
              style={{ borderBottom: "1px solid #2a2a2a" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1f1f1f")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <td style={{ padding: "10px 12px 10px 0" }}>
                <Link
                  href={`/cases/${c.id}`}
                  style={{ color: "#f59e0b", textDecoration: "none", fontWeight: 500 }}
                >
                  {c.name}
                </Link>
              </td>
              <td style={{ padding: "10px 12px 10px 0", color: "#9ca3af" }}>{c.description ?? "—"}</td>
              <td style={{ padding: "10px 12px 10px 0" }}>
                <span
                  style={{
                    borderRadius: "9999px",
                    padding: "2px 8px",
                    fontSize: "11px",
                    fontWeight: 500,
                    backgroundColor: c.status === "active" ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.08)",
                    color: c.status === "active" ? "#22c55e" : "#9ca3af",
                  }}
                >
                  {c.status}
                </span>
              </td>
              <td style={{ padding: "10px 12px 10px 0", color: "#9ca3af" }}>
                {c.case_documents?.[0]?.count ?? 0}
              </td>
              <td style={{ color: "#9ca3af" }}>{new Date(c.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {(cases ?? []).length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: "32px 0", color: "#9ca3af", textAlign: "center" }}>
                No cases yet. Create one above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
