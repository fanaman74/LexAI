import { describe, it, expect } from "vitest";
import { detectSourceType } from "@/lib/files/source-type";

describe("detectSourceType", () => {
  it("maps known extensions", () => {
    expect(detectSourceType("a.pdf")).toBe("pdf");
    expect(detectSourceType("a.DOCX")).toBe("docx");
    expect(detectSourceType("a.xlsx")).toBe("xlsx");
    expect(detectSourceType("a.msg")).toBe("msg");
    expect(detectSourceType("a.eml")).toBe("eml");
  });
  it("falls back to other", () => {
    expect(detectSourceType("a.txt")).toBe("other");
    expect(detectSourceType("noext")).toBe("other");
  });
});
