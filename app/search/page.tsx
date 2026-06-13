import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { SearchClient } from "./search-client";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const supabase = await createClient();
  const sp = await searchParams;

  const { data: cases } = await supabase
    .from("cases")
    .select("id, name")
    .order("name");

  const initialCaseId = typeof sp.case_id === "string" ? sp.case_id : undefined;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-xl font-semibold mb-6">Search</h1>
      <SearchClient cases={cases ?? []} initialCaseId={initialCaseId} />
    </main>
  );
}
