import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Bootstrap a fresh account into the multi-tenant model:
 * - teacher / school_admin / it_admin → creates their own tenant + users row
 * - student → finds the class by join code, joins that class's tenant + roster
 * Idempotent: safe to call after every login (re-joins nothing already there).
 */
export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const role = (body.role ?? "teacher") as string;
  const allowedRoles = new Set(["student", "teacher", "school_admin", "it_admin"]);
  if (!allowedRoles.has(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });
  const fullName = (body.full_name ?? user.user_metadata?.full_name ?? "User") as string;
  const tenantName = (body.tenant_name ?? "My School") as string;
  const tenantSlug = (body.tenant_slug ?? `school-${user.id.slice(0, 8)}`) as string;
  const joinCode = (body.join_code ?? "") as string;

  // Existing profile? already set up.
  const { data: existing } = await sb.from("users").select("id,tenant_id,role").eq("id", user.id).maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, role: existing.role, tenant_id: existing.tenant_id, already: true });
  }

  if (role === "student") {
    const code = joinCode.trim().toUpperCase();
    if (!code) return NextResponse.json({ error: "join_code required for students" }, { status: 400 });
    const { data: cls, error: cErr } = await sb.rpc("class_lookup_by_code", { p_code: code });
    if (cErr || !cls || !cls[0]) return NextResponse.json({ error: "class not found for that code" }, { status: 404 });
    const { error: uErr } = await sb.from("users").insert({
      id: user.id, tenant_id: (cls[0] as { tenant_id: string }).tenant_id,
      email: user.email ?? "", full_name: fullName, role: "student"
    });
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });
    await sb.from("class_members").upsert({
      class_id: (cls[0] as { id: string }).id, user_id: user.id, role: "student"
    }, { onConflict: "class_id,user_id" });
    return NextResponse.json({ ok: true, role: "student", tenant_id: (cls[0] as { tenant_id: string }).tenant_id });
  }

  // Teacher / admin: create tenant then profile row.
  const { data: tenant, error: tErr } = await sb.from("tenants")
    .insert({ name: tenantName, slug: tenantSlug })
    .select("id").maybeSingle();
  if (tErr) {
    // Slug likely taken — try deterministic fallback slug once, then give up.
    const { data: tenant2, error: tErr2 } = await sb.from("tenants")
      .insert({ name: tenantName, slug: `${tenantSlug}-${user.id.slice(0, 6)}` })
      .select("id").maybeSingle();
    if (tErr2 || !tenant2) return NextResponse.json({ error: tErr2?.message ?? tErr.message }, { status: 400 });
    const { error: uErr } = await sb.from("users").insert({
      id: user.id, tenant_id: tenant2.id, email: user.email ?? "",
      full_name: fullName, role
    });
    if (uErr && !uErr.message.includes("duplicate")) return NextResponse.json({ error: uErr.message }, { status: 400 });
    return NextResponse.json({ ok: true, role, tenant_id: tenant2.id });
  }
  const { error: uErr } = await sb.from("users").insert({
    id: user.id, tenant_id: tenant!.id, email: user.email ?? "",
    full_name: fullName, role
  });
  if (uErr && !uErr.message.includes("duplicate")) return NextResponse.json({ error: uErr.message }, { status: 400 });
  return NextResponse.json({ ok: true, role, tenant_id: tenant!.id });
}
