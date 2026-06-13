import { requireUser } from "@/lib/auth/session";

export default async function ReviewPage() {
  await requireUser();
  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 600, color: "#ffffff", marginBottom: "8px" }}>Review</h1>
      <p style={{ color: "#9ca3af", fontSize: "14px" }}>Document review and annotation — coming soon.</p>
    </main>
  );
}
