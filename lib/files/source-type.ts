import type { DocumentSourceType } from "@/lib/types";

const MAP: Record<string, DocumentSourceType> = {
  pdf: "pdf", docx: "docx", xlsx: "xlsx", msg: "msg", eml: "eml",
};

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function detectSourceType(filename: string): DocumentSourceType {
  return MAP[fileExtension(filename)] ?? "other";
}
