import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Nav from "./nav";

export default async function NavServer() {
  const user = await getUser();
  let indexedCount: number | undefined;

  if (user) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("processing_status", "processed");
    indexedCount = count ?? 0;
  }

  return <Nav indexedCount={indexedCount} />;
}
