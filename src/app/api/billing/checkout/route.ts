import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Creates a real Stripe Checkout Session when STRIPE_SECRET_KEY and a plan price mapping are configured. */
export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: me } = await sb.from("users").select("tenant_id,role").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up" }, { status: 400 });
  if (!["school_admin", "it_admin", "platform_admin"].includes(me.role))
    return NextResponse.json({ error: "administrator role required" }, { status: 403 });

  const { plan_id } = await req.json().catch(() => ({}));
  if (typeof plan_id !== "string") return NextResponse.json({ error: "plan_id required" }, { status: 400 });
  const { data: plan } = await sb.from("plans").select("id,name,price_cents").eq("id", plan_id).maybeSingle();
  if (!plan) return NextResponse.json({ error: "plan not found" }, { status: 404 });

  const secret = process.env.STRIPE_SECRET_KEY;
  const envName = plan.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const priceId = process.env[`STRIPE_PRICE_${envName}`];
  if (!secret || !priceId) {
    return NextResponse.json({ error: "Stripe is not configured for this plan", setup: `Set STRIPE_SECRET_KEY and STRIPE_PRICE_${envName}` }, { status: 503 });
  }

  const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/teacher/billing?checkout=success`,
    cancel_url: `${origin}/teacher/billing?checkout=cancelled`,
    client_reference_id: me.tenant_id,
    customer_email: user.email ?? ""
  });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store"
  });
  const result = await response.json();
  if (!response.ok) return NextResponse.json({ error: result?.error?.message ?? "Stripe request failed" }, { status: 502 });
  return NextResponse.json({ url: result.url, session_id: result.id });
}
