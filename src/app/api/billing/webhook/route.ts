import { createHmac, timingSafeEqual } from "node:crypto";
import { fail, ok } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/** Verify Stripe's `Stripe-Signature` header (t=…,v1=…) with a 5-minute tolerance. */
function verify(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

const STATUS: Record<string, string> = { active: "active", trialing: "trialing", past_due: "past_due", unpaid: "past_due", canceled: "canceled", incomplete_expired: "canceled" };

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return fail(501, "Webhook not configured.");
  const payload = await req.text();
  if (!verify(payload, req.headers.get("stripe-signature"), secret)) return fail(400, "Invalid signature.");
  const event = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };
  const obj = event.data.object;
  const sb = createServiceClient();

  if (event.type.startsWith("customer.subscription.")) {
    const meta = (obj.metadata ?? {}) as { tenant_id?: string; plan?: string };
    if (meta.tenant_id && meta.plan) {
      const status = event.type === "customer.subscription.deleted" ? "canceled" : STATUS[String(obj.status)] ?? "past_due";
      const { error } = await sb.rpc("billing_apply_subscription", {
        p_tenant: meta.tenant_id, p_plan: meta.plan, p_status: status, p_provider: "stripe", p_ref: String(obj.id),
        p_period_end: obj.current_period_end ? new Date(Number(obj.current_period_end) * 1000).toISOString() : null
      });
      if (error) return fail(500, error.message);
    }
  } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const lines = (obj.subscription_details ?? obj.parent) as { metadata?: { tenant_id?: string } } | undefined;
    const tenant = lines?.metadata?.tenant_id;
    if (tenant) {
      const { error } = await sb.rpc("billing_record_invoice", {
        p_tenant: tenant, p_amount_cents: Number(obj.amount_paid ?? obj.amount_due ?? 0), p_currency: String(obj.currency ?? "usd"),
        p_status: event.type === "invoice.paid" ? "paid" : "open", p_ref: String(obj.id),
        p_paid_at: event.type === "invoice.paid" ? new Date().toISOString() : null
      });
      if (error) return fail(500, error.message);
    }
  }
  return ok({ received: true });
}
