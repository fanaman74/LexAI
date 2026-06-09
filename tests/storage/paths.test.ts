import { describe, it, expect } from "vitest";
import { LEGAL_BUCKET, originalPath, markdownPath } from "@/lib/storage/paths";

describe("storage paths", () => {
  it("builds original path", () => {
    expect(originalPath("u1", "d1", "letter.pdf"))
      .toBe("u1/d1/original/letter.pdf");
  });
  it("exposes bucket constant", () => {
    expect(LEGAL_BUCKET).toBe("legal-documents");
  });
});

describe("markdownPath", () => {
  it("builds markdown artifact path", () => {
    expect(markdownPath("u1", "d1", "report.pdf"))
      .toBe("u1/d1/markdown/report.pdf.md");
  });
});
