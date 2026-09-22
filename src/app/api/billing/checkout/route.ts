import { fail, ok, readJson, requireProfile } from "@/lib/api";

const PRICE_ENV: Record<string, string> = {
  teacher_pro: "STRIPE_PRICE_TEACHER_PRO",
  school: "STRIPE_PRICE_SCHOOL",
  school_plus: "STRIPE_PRICE_SCHOOL_PLUS"
};

/** Creates a Stripe Checkout session (subscription). Plan changes are applied only by the verified webhook. */
export async function POST(req: Request) {
  const { me, response } = await requireProfile(["school_admin", "platform_admin"]);
  if (response) return response;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return fail(501, "Online payments are not configured on this server.");
  const body = await readJson<{ plan?: string }>(req);
  const envName = PRICE_ENV[body?.plan ?? ""];
  const price = envName ? process.env[envName] : undefined;
  if (!price) return fail(400, "That plan can't be bought online.");

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/admin/billing?status=success`,
    cancel_url: `${origin}/admin/billing?status=cancelled`,
    client_reference_id: me.tenant_id,
    customer_email: me.email,
    "metadata[tenant_id]": me.tenant_id,
    "metadata[plan]": body!.plan!,
    "subscription_data[metadata][tenant_id]": me.tenant_id,
    "subscription_data[metadata][plan]": body!.plan!
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  const json = await res.json();
  if (!res.ok) return fail(502, json?.error?.message ?? "Payment provider error.");
  return ok({ url: json.url });
}
