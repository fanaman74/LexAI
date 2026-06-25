import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, email, phone, notes, created_at")
    .eq("user_id", user.id)
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { name, email, phone, notes } = body as Record<string, string>;
  if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({ user_id: user.id, name: name.trim(), email: email?.trim() || null, phone: phone?.trim() || null, notes: notes?.trim() || null })
    .select("id, name, email, phone, notes, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
