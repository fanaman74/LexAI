import { requireUser } from "@/lib/auth/session";

export default async function ChatPage() {
  await requireUser();
  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 600, color: "#ffffff", marginBottom: "8px" }}>Chat</h1>
      <p style={{ color: "#9ca3af", fontSize: "14px", marginBottom: "8px" }}>
        Ask AI questions about your documents and cases.
      </p>
      <p style={{ color: "#6b7280", fontSize: "13px" }}>
        Open a case and use the "Ask AI" button to start a conversation.
      </p>
    </main>
  );
}
