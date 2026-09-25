import { createHmac, timingSafeEqual } from "node:crypto";
import { fail, ok, withErrorLog } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/** Verify Stripe's `Stripe-Signature` header (t=…,v1=…) with a 5-minute tolerance. */
function verify(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const pairs = header.split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const; });
  const t = Number(pairs.find(([k]) => k === "t")?.[1]);
  // While a signing secret is being rotated Stripe sends several v1 signatures; any one may match.
  const sigs = pairs.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !sigs.length) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  return sigs.some((s) => { const b = Buffer.from(s); return b.length === expected.length && timingSafeEqual(expected, b); });
}

const STATUS: Record<string, string> = { active: "active", trialing: "trialing", past_due: "past_due", unpaid: "past_due", canceled: "canceled", incomplete_expired: "canceled" };

export const POST = withErrorLog(async function POST(req: Request) {
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
});
