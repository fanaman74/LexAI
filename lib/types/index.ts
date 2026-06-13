export type DocumentSourceType =
  | "pdf" | "docx" | "xlsx" | "msg" | "eml" | "email_attachment" | "other";

export type ProcessingStatus =
  | "uploaded" | "queued" | "processing" | "processed" | "failed";

export type LegalDocument = {
  id: string;
  user_id: string;
  original_filename: string;
  display_title?: string | null;
  source_type: DocumentSourceType;
  parent_document_id?: string | null;
  duplicate_of_document_id?: string | null;
  processing_status: ProcessingStatus;
  ai_short_summary?: string | null;
  ai_keywords?: string[] | null;
  created_at: string;
};

export type DocumentChunk = {
  id: string;
  document_id: string;
  chunk_id: string;
  chunk_index: number;
  content: string;
  content_markdown?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  sheet_name?: string | null;
  row_start?: number | null;
  row_end?: number | null;
  metadata: Record<string, unknown>;
};

export type AuditAction =
  | "upload_document" | "view_document" | "download_original"
  | "run_keyword_search" | "run_semantic_search" | "run_hybrid_search"
  | "run_ai_summary" | "delete_document" | "reprocess_document"
  | "assign_to_case" | "remove_from_case" | "export_case_bundle"
  | "delete" | "download" | "reconstruct" | "reprocess" | "search";
