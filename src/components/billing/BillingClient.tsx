"use client";
import { useEffect, useState } from "react";

type Plan = { id: string; name: string; price_cents: number; features: Record<string, unknown> };
type Sub = { id: string; plan: string; status: string; renews_at: string | null; created_at: string } | null;
type Invoice = { id: string; amount_cents: number; status: string; created_at: string };

export default function BillingClient({ initialPlans }: { initialPlans: Plan[] }) {
  const [plans] = useState<Plan[]>(initialPlans);
  const [sub, setSub] = useState<Sub>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/subscriptions").then(r => r.json()).then((j) => {
      setSub(j.subscription ?? null);
      setInvoices(j.invoices ?? []);
    }).catch(() => {});
  }, []);

  async function subscribe(planId: string) {
    setBusy(true); setMessage(null);
    const checkout = await fetch("/api/billing/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: planId })
    });
    const checkoutJson = await checkout.json().catch(() => ({}));
    if (checkout.ok && checkoutJson.url) {
      window.location.assign(checkoutJson.url);
      return;
    }
    // Free plans and local development still use the RLS-backed subscription record.
    const r = await fetch("/api/subscriptions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: planId })
    });
    setBusy(false);
    if (!r.ok) { setMessage(checkoutJson.error ?? "Subscription failed"); return; }
    setSub(await r.json());
    setMessage("Subscription record created.");
  }

  return (
    <div className="space-y-6">
      {message && <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">{message}</p>}
      {sub && (
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-slate-500">Current plan</p>
              <p className="text-xl font-bold">{sub.plan} <span className={"ml-2 rounded-full px-2 py-0.5 text-xs " + (sub.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{sub.status}</span></p>
            </div>
            {sub.renews_at && <p className="text-xs text-slate-500">Renews {new Date(sub.renews_at).toLocaleDateString()}</p>}
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {plans.map(p => (
          <div key={p.id} className="card flex flex-col p-5">
            <h3 className="font-semibold">{p.name}</h3>
            <p className="mt-1 text-2xl font-bold">${(p.price_cents / 100).toFixed(2)}<span className="text-sm font-normal text-slate-400">/mo</span></p>
            <ul className="mt-3 flex-1 space-y-1 text-xs text-slate-600">
              {Object.entries(p.features ?? {}).map(([k, v]) => (
                <li key={k}>{String(v)} {k.replaceAll("_", " ")}</li>
              ))}
            </ul>
            <button onClick={() => subscribe(p.id)} disabled={busy} className="btn btn-primary mt-4 w-full text-xs">
              {sub?.plan === p.name ? "Current" : "Select"}
            </button>
          </div>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-lg font-semibold">Invoices</h2>
        {invoices.length === 0 && <p className="py-3 text-sm text-slate-400">No invoices yet.</p>}
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Date</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {invoices.map(i => (
              <tr key={i.id} className="border-t border-slate-100">
                <td className="py-2">{new Date(i.created_at).toLocaleDateString()}</td>
                <td>${(i.amount_cents / 100).toFixed(2)}</td>
                <td className="capitalize">{i.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-400">Paid plans use Stripe Checkout when configured; local development keeps an RLS-backed subscription record.</p>
      </section>
    </div>
  );
}
