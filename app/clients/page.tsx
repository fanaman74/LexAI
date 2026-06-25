"use client";
import { useEffect, useState } from "react";

type Client = { id: string; name: string; email?: string; phone?: string; notes?: string; created_at: string };

const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  fontSize: "13px",
  borderRadius: "6px",
  border: "1px solid #2a2a2a",
  backgroundColor: "#0d0d0d",
  color: "#ffffff",
  outline: "none",
  boxSizing: "border-box" as const,
};

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/clients");
    if (res.ok) setClients(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addClient(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const c = await res.json();
      setClients((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)));
      setForm({ name: "", email: "", phone: "", notes: "" });
    } else {
      const j = await res.json();
      setError(j.error ?? "Failed to add client");
    }
    setSaving(false);
  }

  return (
    <main style={{ maxWidth: "860px", margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#ffffff", marginBottom: "4px" }}>Clients</h1>
      <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "28px" }}>Manage clients and link their documents.</p>

      {/* Add client form */}
      <div style={{ backgroundColor: "#111", border: "1px solid #2a2a2a", borderRadius: "10px", padding: "20px", marginBottom: "28px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 600, color: "#f59e0b", marginBottom: "14px" }}>Add new client</h2>
        <form onSubmit={addClient} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ fontSize: "11px", color: "#9ca3af", display: "block", marginBottom: "4px" }}>Name *</label>
            <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Full name or company" />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "#9ca3af", display: "block", marginBottom: "4px" }}>Email</label>
            <input style={inputStyle} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="client@example.com" />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "#9ca3af", display: "block", marginBottom: "4px" }}>Phone</label>
            <input style={inputStyle} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ fontSize: "11px", color: "#9ca3af", display: "block", marginBottom: "4px" }}>Notes</label>
            <textarea style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes…" />
          </div>
          {error && <p style={{ gridColumn: "1 / -1", color: "#ef4444", fontSize: "13px" }}>{error}</p>}
          <div style={{ gridColumn: "1 / -1" }}>
            <button
              type="submit"
              disabled={saving || !form.name.trim()}
              style={{
                padding: "9px 20px",
                fontSize: "13px",
                fontWeight: 600,
                borderRadius: "6px",
                backgroundColor: saving || !form.name.trim() ? "#555" : "#f59e0b",
                color: "#000",
                border: "none",
                cursor: saving || !form.name.trim() ? "not-allowed" : "pointer",
                opacity: saving || !form.name.trim() ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : "Add client"}
            </button>
          </div>
        </form>
      </div>

      {/* Client list */}
      {loading ? (
        <p style={{ color: "#6b7280", fontSize: "13px" }}>Loading…</p>
      ) : clients.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: "13px" }}>No clients yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {clients.map((c) => (
            <div key={c.id} style={{ backgroundColor: "#111", border: "1px solid #2a2a2a", borderRadius: "8px", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <p style={{ fontSize: "14px", fontWeight: 600, color: "#ffffff", marginBottom: "2px" }}>{c.name}</p>
                <p style={{ fontSize: "12px", color: "#6b7280" }}>
                  {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact info"}
                </p>
                {c.notes && <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>{c.notes}</p>}
              </div>
              <span style={{ fontSize: "11px", color: "#4b5563", whiteSpace: "nowrap", marginLeft: "16px" }}>
                {new Date(c.created_at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
