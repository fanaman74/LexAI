"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Props = {
  sourceTypes: string[];
  cases: { id: string; name: string }[];
};

export function Filters({ sourceTypes, cases }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.replace(pathname + "?" + params.toString());
  }

  return (
    <div className="mt-4 flex flex-wrap gap-3 text-sm">
      <select
        value={sp.get("source_type") ?? ""}
        onChange={(e) => update("source_type", e.target.value)}
        className="rounded border px-2 py-1"
      >
        <option value="">All types</option>
        {sourceTypes.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <select
        value={sp.get("processing_status") ?? ""}
        onChange={(e) => update("processing_status", e.target.value)}
        className="rounded border px-2 py-1"
      >
        <option value="">All statuses</option>
        {["queued", "processing", "processed", "failed"].map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select
        value={sp.get("case_id") ?? ""}
        onChange={(e) => update("case_id", e.target.value)}
        className="rounded border px-2 py-1"
      >
        <option value="">All cases</option>
        {cases.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Search filename…"
        value={sp.get("q") ?? ""}
        onChange={(e) => update("q", e.target.value)}
        className="rounded border px-2 py-1"
      />
    </div>
  );
}
