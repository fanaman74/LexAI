import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sha256Hex } from "@/lib/files/hash";
import { detectSourceType, fileExtension } from "@/lib/files/source-type";
import { LEGAL_BUCKET, originalPath } from "@/lib/storage/paths";
import { uploadOriginal } from "@/lib/storage/storage";
import { logAudit } from "@/lib/audit/audit";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0)
    return NextResponse.json({ error: "no files" }, { status: 400 });
  const clientId = (form.get("client_id") as string | null) || null;

  function errMsg(e: unknown): string {
    if (e instanceof Error) return e.message;
    if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
    return JSON.stringify(e);
  }

  const results = [];
  for (const file of files) {
    // webkitdirectory includes the folder path in file.name — strip it to just the basename
    const basename = file.name.includes("/") ? file.name.split("/").pop()! : file.name;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await sha256Hex(bytes);

      const { data: dup } = await supabase
        .from("documents")
        .select("id")
        .eq("user_id", user.id)
        .eq("sha256_hash", hash)
        .limit(1)
        .maybeSingle();

      const sourceType = detectSourceType(basename);
      const { data: doc, error: insErr } = await supabase
        .from("documents")
        .insert({
          user_id: user.id,
          original_filename: basename,
          file_extension: fileExtension(basename),
          mime_type: file.type || null,
          file_size_bytes: file.size,
          storage_bucket: LEGAL_BUCKET,
          storage_path: "",
          sha256_hash: hash,
          duplicate_of_document_id: dup?.id ?? null,
          source_type: sourceType,
          processing_status: "uploaded",
          client_id: clientId,
        })
        .select("id")
        .single();
      if (insErr || !doc) throw insErr ?? new Error("insert failed");

      const path = originalPath(user.id, doc.id, basename);
      try {
        await uploadOriginal(supabase, path, bytes, file.type || undefined);
        await supabase.from("documents")
          .update({ storage_path: path, processing_status: "queued" })
          .eq("id", doc.id);
      } catch (storageErr) {
        await supabase.from("documents")
          .update({ processing_error: errMsg(storageErr) })
          .eq("id", doc.id);
        throw storageErr;
      }

      await logAudit(supabase, user.id, "upload_document", {
        document_id: doc.id, metadata: { filename: basename, is_duplicate: !!dup },
      });

      results.push({
        document_id: doc.id, original_filename: basename,
        source_type: sourceType, status: "queued", is_duplicate: !!dup,
      });
    } catch (e) {
      results.push({ original_filename: basename, status: "failed", error: errMsg(e) });
    }
  }
  return NextResponse.json({ results });
}
