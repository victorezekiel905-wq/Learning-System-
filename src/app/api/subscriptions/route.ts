import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: me } = await sb.from("users").select("id,tenant_id").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up" }, { status: 400 });

  const [subs, plans, invoices] = await Promise.all([
    sb.from("subscriptions").select("*").eq("tenant_id", me.tenant_id).order("created_at", { ascending: false }).limit(5),
    sb.from("plans").select("*").order("price_cents"),
    sb.from("invoices").select("*").eq("tenant_id", me.tenant_id).order("created_at", { ascending: false }).limit(10)
  ]);
  return NextResponse.json({
    subscription: subs.data?.[0] ?? null,
    plans: plans.data ?? [],
    invoices: invoices.data ?? []
  });
}

/** Subscribe to a plan (sandbox checkout: writes real rows, no payment gateway). */
export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  const planId = body.plan_id as string | undefined;

  const { data: me } = await sb.from("users").select("id,tenant_id,role").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up" }, { status: 400 });
  if (!["school_admin", "it_admin", "platform_admin"].includes(me.role))
    return NextResponse.json({ error: "only administrators can manage subscriptions" }, { status: 403 });

  const plan = planId
    ? (await sb.from("plans").select("id,name,price_cents").eq("id", planId).maybeSingle()).data
    : null;

  const { data: sub, error } = await sb.from("subscriptions").insert({
    tenant_id: me.tenant_id,
    plan: plan?.name ?? "free",
    status: "trial",
    renews_at: new Date(Date.now() + 30 * 86400_000).toISOString()
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await sb.from("invoices").insert({
    tenant_id: me.tenant_id, amount_cents: plan?.price_cents ?? 0, status: "pending"
  });
  await sb.from("audit_logs").insert({
    tenant_id: me.tenant_id, actor_id: user.id, action: "subscription.created",
    target: sub.id, meta: { plan: sub.plan }
  });
  return NextResponse.json(sub);
}
