export const LEGAL_BUCKET =
  process.env.STORAGE_BUCKET_LEGAL_DOCUMENTS ?? "legal-documents";

export function originalPath(
  userId: string, documentId: string, filename: string
): string {
  return `${userId}/${documentId}/original/${filename}`;
}

export function attachmentPath(
  userId: string, parentDocumentId: string,
  attachmentDocumentId: string, filename: string
): string {
  return `${userId}/${parentDocumentId}/attachments/${attachmentDocumentId}/${filename}`;
}

export function markdownPath(
  userId: string, documentId: string, originalFilename: string
): string {
  return `${userId}/${documentId}/markdown/${originalFilename}.md`;
}
