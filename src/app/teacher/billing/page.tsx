import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BillingClient from "@/components/billing/BillingClient";

export default async function BillingPage() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: plans } = await sb.from("plans").select("*").order("price_cents");
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm font-medium text-brand-600">Fusion Admin · Billing</p>
        <h1 className="text-2xl font-semibold">Plans & subscription</h1>
      </header>
      <BillingClient initialPlans={(plans ?? []).map((p: { id: string; name: string; price_cents: number; features: Record<string, unknown> }) => ({ id: p.id, name: p.name, price_cents: p.price_cents, features: p.features }))} />
    </main>
  );
}
