import type { SupabaseClient } from "@supabase/supabase-js";
import { LEGAL_BUCKET } from "@/lib/storage/paths";

export async function uploadOriginal(
  supabase: SupabaseClient, path: string, bytes: Uint8Array, contentType?: string
): Promise<void> {
  const { error } = await supabase.storage
    .from(LEGAL_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
}

export async function signedUrl(
  supabase: SupabaseClient, path: string, expiresInSeconds = 300
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(LEGAL_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
