"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Props = {
  sourceTypes: string[];
  cases: { id: string; name: string }[];
};

const pillBase: React.CSSProperties = {
  borderRadius: "9999px",
  padding: "4px 12px",
  fontSize: "12px",
  border: "1px solid #2a2a2a",
  color: "#9ca3af",
  cursor: "pointer",
  background: "transparent",
};
const pillActive: React.CSSProperties = {
  ...pillBase,
  border: "1px solid #f59e0b",
  color: "#f59e0b",
  backgroundColor: "rgba(245,158,11,0.1)",
};

export function Filters({ sourceTypes, cases }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function set(key: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    const current = params.get(key);
    if (current === value) {
      params.delete(key);
    } else if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.replace(pathname + "?" + params.toString());
  }

  const currentType = sp.get("source_type") ?? "";
  const currentStatus = sp.get("processing_status") ?? "";
  const currentCase = sp.get("case_id") ?? "";

  const typeLabels: Record<string, string> = {
    pdf: "pdf", docx: "docx", doc: "doc", msg: "msg", eml: "eml",
    xlsx: "xlsx", csv: "csv", txt: "txt", email_attachment: "attachment",
  };
  const statuses = ["processed", "pending", "failed", "queued", "processing"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
      {cases.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "11px", color: "#9ca3af", width: "56px", flexShrink: 0 }}>CASES</span>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {cases.map((c) => (
              <button
                key={c.id}
                onClick={() => set("case_id", c.id)}
                style={currentCase === c.id ? pillActive : pillBase}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", color: "#9ca3af", width: "56px", flexShrink: 0 }}>TYPE</span>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {sourceTypes.map((t) => (
            <button
              key={t}
              onClick={() => set("source_type", t)}
              style={currentType === t ? pillActive : pillBase}
            >
              {typeLabels[t] ?? t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", color: "#9ca3af", width: "56px", flexShrink: 0 }}>STATUS</span>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => set("processing_status", s)}
              style={currentStatus === s ? pillActive : pillBase}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
