export type ExtractResult = {
  text: string;      // plain text
  markdown: string;  // markdown formatted
};

export async function extractText(bytes: Buffer, filename: string): Promise<ExtractResult> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "pdf") return extractPdf(bytes);
  if (ext === "docx") return extractDocx(bytes);
  if (ext === "xlsx" || ext === "xls") return extractXlsx(bytes);
  if (ext === "eml") return extractEml(bytes);
  if (ext === "msg") return extractMsg(bytes);
  if (ext === "txt" || ext === "md") {
    const text = bytes.toString("utf-8");
    return { text, markdown: text };
  }

  throw new Error(`Unsupported file type: .${ext}`);
}

async function extractPdf(bytes: Buffer): Promise<ExtractResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse: any = (await import("pdf-parse" as any));
  const fn = pdfParse.default ?? pdfParse;
  const result = await fn(bytes);
  const text = result.text.trim();
  const markdown = `# Document\n\n${text}`;
  return { text, markdown };
}

async function extractDocx(bytes: Buffer): Promise<ExtractResult> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer: bytes });
  const { value: text } = await mammoth.extractRawText({ buffer: bytes });
  const markdown = htmlToMarkdown(html);
  return { text: text.trim(), markdown };
}

async function extractXlsx(bytes: Buffer): Promise<ExtractResult> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "buffer" });
  const sections: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(ws);
    sections.push(`## ${sheetName}\n\n\`\`\`\n${csv}\n\`\`\``);
  }
  const markdown = sections.join("\n\n");
  const text = wb.SheetNames.map((n) => {
    const ws = wb.Sheets[n];
    return XLSX.utils.sheet_to_csv(ws);
  }).join("\n\n");
  return { text, markdown };
}

async function extractEml(bytes: Buffer): Promise<ExtractResult> {
  const { simpleParser } = await import("mailparser");
  const mail = await simpleParser(bytes);
  const subject = mail.subject ?? "(no subject)";
  const from = mail.from?.text ?? "";
  const to = mail.to ? (Array.isArray(mail.to) ? mail.to.map((a) => a.text).join(", ") : mail.to.text) : "";
  const date = mail.date?.toISOString() ?? "";
  const htmlBody = typeof mail.html === "string" ? mail.html.replace(/<[^>]+>/g, " ") : "";
  const body = mail.text ?? htmlBody ?? "";

  const markdown = `# ${subject}\n\n**From:** ${from}  \n**To:** ${to}  \n**Date:** ${date}\n\n---\n\n${body}`;
  const text = `Subject: ${subject}\nFrom: ${from}\nTo: ${to}\nDate: ${date}\n\n${body}`;
  return { text: text.trim(), markdown };
}

async function extractMsg(bytes: Buffer): Promise<ExtractResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import("@kenjiuno/msgreader") as any;
  const MsgReader = mod.default ?? mod.MsgReader;
  const reader = new MsgReader(bytes);
  const msg = reader.getFileData();
  const subject = msg.subject ?? "(no subject)";
  const senderName = msg.senderName ?? "";
  const senderEmail = msg.senderEmail ?? "";
  const body = msg.body ?? "";

  const markdown = `# ${subject}\n\n**From:** ${senderName} <${senderEmail}>\n\n---\n\n${body}`;
  const text = `Subject: ${subject}\nFrom: ${senderName} <${senderEmail}>\n\n${body}`;
  return { text: text.trim(), markdown };
}

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "_$1_")
    .replace(/<i[^>]*>(.*?)<\/i>/gi, "_$1_")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .trim();
}
