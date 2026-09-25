import { LEGAL } from "@/lib/legal";
import { requireRole, ADMINS } from "@/lib/session";
import { Alert, Badge, Card, PageHeader, Stat } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { UpgradeButton } from "./UpgradeButton";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Plan & billing" };

type Usage = { active_teachers_30d: number; active_students_30d: number; max_students_per_class: number; classes: number; storage_mb: number; managed_devices: number; monitoring_minutes_30d: number; retention: { learning_days: number; telemetry_days: number }; plan: { code: string; name: string; limits: Record<string, number | null> } };

export default async function BillingPage(props: { searchParams: Promise<{ status?: string }> }) {
  const searchParams = await props.searchParams;
  const { sb } = await requireRole(ADMINS);
  const [{ data: usage }, { data: plans }, { data: subs }, { data: invoices }] = await Promise.all([
    sb.rpc("usage_metrics"),
    sb.from("plans").select("*").order("sort"),
    sb.from("subscriptions").select("plan_code,status,provider,current_period_end,created_at").order("created_at", { ascending: false }).limit(5),
    sb.from("invoices").select("id,amount_cents,currency,status,issued_at,paid_at").order("issued_at", { ascending: false }).limit(24)
  ]);
  const u = usage as Usage;
  const limit = (k: string) => u.plan.limits[k] ?? "∞";
  const stripe = Boolean(process.env.STRIPE_SECRET_KEY);

  return (
    <div className="page">
      <PageHeader title="Plan & billing" subtitle={`Current plan: ${u.plan.name}`} />
      {searchParams.status === "success" && <div className="mb-4"><Alert tone="success">Payment received. Your plan updates as soon as the payment provider confirms it.</Alert></div>}
      {searchParams.status === "cancelled" && <div className="mb-4"><Alert tone="warn">Checkout was cancelled.</Alert></div>}
      <h2 className="mb-3 font-display text-[15px] font-bold text-ink-900">Usage (billing metrics)</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active teachers (30d)" value={u.active_teachers_30d} sub={`limit ${limit("teachers")}`} />
        <Stat label="Active students (30d)" value={u.active_students_30d} />
        <Stat label="Largest class" value={u.max_students_per_class} sub={`limit ${limit("students_per_class")}`} />
        <Stat label="Classes" value={u.classes} sub={`limit ${limit("classes")}`} />
        <Stat label="Storage" value={`${u.storage_mb} MB`} sub={`limit ${limit("storage_mb")} MB`} />
        <Stat label="Managed devices" value={u.managed_devices} sub={`limit ${limit("managed_devices")}`} />
        <Stat label="Monitoring minutes (30d)" value={u.monitoring_minutes_30d} />
        <Stat label="Retention" value={`${u.retention.learning_days}d / ${u.retention.telemetry_days}d`} sub="learning / telemetry" />
      </div>

      <h2 className="mb-3 mt-8 font-display text-[15px] font-bold text-ink-900">Plans</h2>
      {!stripe && <div className="mb-3"><Alert>Online payments aren't set up on this server (no STRIPE_SECRET_KEY). Contact SwiftCipher to change plan manually, or use local payment options.</Alert></div>}
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {(plans ?? []).map((p) => (
          <Card key={p.code} className={p.code === u.plan.code ? "ring-2 ring-brand-500" : ""}>
            <p className="font-bold">{p.name}</p>
            <p className="mt-1 font-display text-2xl font-extrabold">{p.code === "enterprise" ? "Custom" : p.price_cents === 0 ? "Free" : `$${(p.price_cents / 100).toLocaleString()}`}<span className="text-sm font-normal text-ink-500">{p.price_cents ? `/${p.interval}` : ""}</span></p>
            <ul className="mt-3 space-y-1 text-xs text-ink-600">
              {Object.entries(p.limits as Record<string, number | null>).map(([k, v]) => <li key={k}>{k.replace(/_/g, " ")}: {v ?? "unlimited"}</li>)}
              {Object.entries(p.features as Record<string, boolean>).filter(([, v]) => v).map(([k]) => <li key={k} className="flex items-center gap-2"><Icon name="check" className="h-3.5 w-3.5 text-emerald-700" />{k.replace(/_/g, " ")}</li>)}
            </ul>
            <div className="mt-4">{p.code === u.plan.code ? <Badge tone="brand">Current plan</Badge> : p.code === "enterprise" ? <a href={`mailto:${LEGAL.infoEmail}?subject=Enterprise%20plan`} className="btn btn-secondary btn-sm no-underline">Contact sales</a>
              : p.price_cents > 0 && <UpgradeButton plan={p.code} disabled={!stripe} />}</div>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card title="Subscription history" pad={false}>
          <table className="table"><tbody>{(subs ?? []).map((s, i) => <tr key={i}><td>{s.plan_code}</td><td><Badge tone={s.status === "active" ? "green" : "gray"}>{s.status}</Badge></td><td className="text-xs">{s.provider}</td><td className="text-xs">{s.current_period_end ? `renews ${formatDate(s.current_period_end)}` : ""}</td></tr>)}</tbody></table>
        </Card>
        <Card title="Invoices" pad={false}>
          {!(invoices ?? []).length ? <p className="p-5 text-sm text-ink-500">No invoices yet.</p> : (
            <table className="table"><tbody>{(invoices ?? []).map((iv) => <tr key={iv.id}><td>{formatDate(iv.issued_at)}</td><td className="tabular-nums">{(iv.amount_cents / 100).toFixed(2)} {iv.currency}</td><td><Badge tone={iv.status === "paid" ? "green" : "amber"}>{iv.status}</Badge></td></tr>)}</tbody></table>
          )}
        </Card>
      </div>
    </div>
  );
}
