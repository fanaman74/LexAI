"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewCaseForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create case");
      }
      setName("");
      setDescription("");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border p-4 bg-gray-50 max-w-lg">
      <h2 className="text-sm font-semibold text-gray-700">New Case</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <input
        className="rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        placeholder="Case name *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        className="rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="self-start rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Creating…" : "Create Case"}
      </button>
    </form>
  );
}
