"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, Select, Textarea, Toggle, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { errorText, rpc } from "@/lib/rpc";
import type { Me, TenantSettings } from "@/lib/types";
import { uploadMedia, useSignedUrl } from "@/lib/media";
import { contrastWithWhite, paletteVars } from "@/lib/theme";

/** Tenant branding: only this school sees it; other schools are unaffected. */
function BrandingCard({ s, set, tenantId }: { s: TenantSettings; set: (p: Partial<TenantSettings>) => void; tenantId: string }) {
  const toast = useToast();
  const logo = useSignedUrl(s.brand_logo_path);
  const [busy, setBusy] = useState(false);
  const primary = s.brand_primary ?? "#4f46e5";
  const accent = s.brand_accent ?? "#0891b2";
  const lowContrast = contrastWithWhite(primary) < 4.5;
  const preview = { ...paletteVars("brand", primary), ...paletteVars("accent", accent) } as React.CSSProperties;

  async function upload(f: File) {
    if (!f.type.startsWith("image/")) { toast("Choose an image file.", "error"); return; }
    setBusy(true);
    try {
      const { data: { user } } = await createClient().auth.getUser();
      const m = await uploadMedia(f, { tenantId, userId: user!.id, alt: "School logo", tags: ["branding"] });
      set({ brand_logo_path: m.storage_path });
    } catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }

  return (
    <Card title="Branding (your school's pages)">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Display name" hint="Shown in the sidebar and header instead of SwiftCipher.">
            <Input value={s.brand_name ?? ""} maxLength={80} onChange={(e) => set({ brand_name: e.target.value || null })} />
          </Field>
          <Field label="Logo" hint="Square PNG or SVG works best.">
            <div className="flex items-center gap-3">
              {logo ? <img src={logo} alt="School logo" className="h-12 w-12 rounded-lg border border-ink-200 object-contain" /> : <span className="grid h-12 w-12 place-items-center rounded-lg bg-ink-100 text-xs text-ink-400">none</span>}
              <label className="btn btn-secondary btn-sm cursor-pointer">{busy ? "Uploading…" : "Upload logo"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} /></label>
              {s.brand_logo_path && <Button size="sm" variant="ghost" onClick={() => set({ brand_logo_path: null })}>Remove</Button>}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Main colour"><div className="flex items-center gap-2"><input type="color" value={primary} onChange={(e) => set({ brand_primary: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-ink-300" /><Input value={primary} onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && set({ brand_primary: e.target.value })} /></div></Field>
            <Field label="Accent colour"><div className="flex items-center gap-2"><input type="color" value={accent} onChange={(e) => set({ brand_accent: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-ink-300" /><Input value={accent} onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && set({ brand_accent: e.target.value })} /></div></Field>
          </div>
          {lowContrast && <Alert tone="warn">This main colour is too light for white button text to be readable. Choose a darker shade.</Alert>}
          <Field label="Welcome message" hint="Shown at the top of every teacher's and student's home page.">
            <Textarea rows={2} maxLength={500} value={s.welcome_message ?? ""} onChange={(e) => set({ welcome_message: e.target.value || null })} />
          </Field>
          <Button size="sm" variant="ghost" onClick={() => set({ brand_name: null, brand_logo_path: null, brand_primary: null, brand_accent: null, welcome_message: null })}>Reset to SwiftCipher defaults</Button>
        </div>
        <div style={preview} className="rounded-xl border border-ink-200 bg-ink-50 p-4">
          <p className="label">Preview</p>
          <div className="flex items-center gap-2">
            {logo ? <img src={logo} alt="" className="h-8 w-8 rounded-lg object-contain" /> : <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-black text-white">{(s.brand_name ?? "S")[0]}</span>}
            <span className="font-extrabold">{s.brand_name || "SwiftCipher"}</span>
          </div>
          {s.welcome_message && <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">{s.welcome_message}</div>}
          <div className="mt-3 flex flex-wrap gap-2"><span className="btn btn-primary btn-sm">Primary button</span><span className="btn btn-accent btn-sm">Accent</span><span className="badge bg-brand-50 text-brand-700">Badge</span></div>
          <p className="mt-2 text-xs text-ink-500">Click <strong>Save settings</strong> at the bottom to apply it for everyone in your school.</p>
        </div>
      </div>
    </Card>
  );
}

type Tenant = { id: string; name: string; country: string | null; timezone: string; slug: string };
const KNOWN_FLAGS = [
  { key: "games", label: "Challenge games" }, { key: "device_control", label: "Device monitoring & commands" },
  { key: "advanced_analytics", label: "Advanced analytics" }, { key: "parent_portal", label: "Parent portal" }
];

export function SettingsClient({ tenant, settings, schools, flags, plan }: {
  tenant: Tenant; settings: TenantSettings & { tenant_id: string }; schools: { id: string; name: string }[];
  flags: { id: string; key: string; enabled: boolean; tenant_id: string | null }[]; plan: NonNullable<Me["plan"]>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [t, setT] = useState(tenant);
  const [s, setS] = useState(settings);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<TenantSettings>) => setS({ ...s, ...p });

  async function saveAll() {
    setBusy(true);
    const sb = createClient();
    const a = await sb.from("tenants").update({ name: t.name, country: t.country, timezone: t.timezone }).eq("id", t.id);
    const { tenant_id: _tid, monitoring_notice_version: _v, ...rest } = s as TenantSettings & { tenant_id: string; updated_at?: string };
    delete (rest as { updated_at?: string }).updated_at;
    const b = await sb.from("tenant_settings").update(rest).eq("tenant_id", t.id);
    setBusy(false);
    const err = a.error ?? b.error;
    if (err) toast(err.message, "error"); else { toast("Settings saved", "success"); router.refresh(); }
  }

  async function flag(key: string, enabled: boolean) {
    const sb = createClient();
    const existing = flags.find((f) => f.key === key && f.tenant_id);
    const { error } = existing ? await sb.from("feature_flags").update({ enabled }).eq("id", existing.id)
      : await sb.from("feature_flags").insert({ tenant_id: t.id, key, enabled });
    if (error) toast(error.message, "error"); else router.refresh();
  }

  return (
    <div className="space-y-6">
      <BrandingCard s={s} set={set} tenantId={t.id} />

      <Card title="School profile">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name"><Input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
          <Field label="Country"><Input value={t.country ?? ""} onChange={(e) => setT({ ...t, country: e.target.value })} /></Field>
          <Field label="Time zone"><Input value={t.timezone} onChange={(e) => setT({ ...t, timezone: e.target.value })} placeholder="Africa/Lagos" /></Field>
        </div>
        <div className="mt-4"><p className="label">Campuses</p>
          <div className="flex flex-wrap gap-2">{schools.map((x) => <span key={x.id} className="badge bg-ink-100">{x.name}</span>)}
            <Button size="sm" variant="secondary" onClick={async () => { const name = prompt("Campus name"); if (!name) return; const { error } = await createClient().from("schools").insert({ tenant_id: t.id, name }); if (error) toast(error.message, "error"); else router.refresh(); }}>Add campus</Button></div></div>
      </Card>

      <Card title="Classroom monitoring (Guard)">
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle checked={s.allow_screen_capture} onChange={(v) => set({ allow_screen_capture: v })} label="Screen thumbnails" description="Low-resolution frames during live sessions only." />
          <Toggle checked={s.allow_spotlight} onChange={(v) => set({ allow_spotlight: v })} label="Student screen spotlight" description="Teachers can show a student's screen to the class; the student is always told." />
          <Toggle checked={s.store_event_screenshots} onChange={(v) => set({ store_event_screenshots: v })} label="Keep a screenshot with leave alerts" description="Off by default. Kept only for the telemetry retention period." />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Thumbnail every (s)"><Input type="number" min={5} max={300} value={s.thumbnail_interval_seconds} onChange={(e) => set({ thumbnail_interval_seconds: Number(e.target.value) })} /></Field>
            <Field label="Default grace (s)"><Input type="number" min={0} max={600} value={s.default_grace_seconds} onChange={(e) => set({ default_grace_seconds: Number(e.target.value) })} /></Field>
            <Field label="Default idle (s)"><Input type="number" min={30} max={7200} value={s.default_idle_seconds} onChange={(e) => set({ default_idle_seconds: Number(e.target.value) })} /></Field>
          </div>
        </div>
        <Field className="mt-4" label="Student-facing monitoring notice" hint="Shown in the extension and at the start of managed sessions. Changing it asks every student to acknowledge it again.">
          <Textarea rows={3} value={s.monitoring_notice} onChange={(e) => set({ monitoring_notice: e.target.value })} />
        </Field>
      </Card>

      <Card title="Communication & content moderation">
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle checked={s.allow_group_chat} onChange={(v) => set({ allow_group_chat: v })} label="Allow class group chat" description="Teachers switch it on per session; private 1:1 chat is always available." />
          <Field label="Default leaderboard names"><Select value={s.nickname_mode} onChange={(e) => set({ nickname_mode: e.target.value as TenantSettings["nickname_mode"] })}>
            <option value="first_name_initial">First name + last initial</option><option value="approved_nickname">Teacher-approved nicknames</option><option value="anonymous">Anonymous</option>
          </Select></Field>
          <Toggle checked={s.parent_portal_enabled} onChange={(v) => set({ parent_portal_enabled: v })} label="Parent portal" description="Linked parents see attendance, released grades and screen-time summaries." />
          <Toggle checked={s.email_alerts_enabled} onChange={(v) => set({ email_alerts_enabled: v })} label="Email alerts to teachers" description="Critical environment alerts are also emailed (requires email set up)." />
        </div>
      </Card>

      <Card title="Data retention (§20)">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Learning data (days)" hint="Attempts, games, chat. 30–3650."><Input type="number" min={30} max={3650} value={s.learning_retention_days} onChange={(e) => set({ learning_retention_days: Number(e.target.value) })} /></Field>
          <Field label="Device telemetry (days)" hint="Browsing events, alerts, screenshots. 1–365."><Input type="number" min={1} max={365} value={s.telemetry_retention_days} onChange={(e) => set({ telemetry_retention_days: Number(e.target.value) })} /></Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button variant="secondary" onClick={async () => { try { const r = await rpc<Record<string, number>>("apply_retention", {}); toast(`Retention applied: ${Object.entries(r).map(([k, v]) => `${v} ${k}`).join(", ")}`, "success"); } catch (e) { toast(errorText(e), "error"); } }}>Apply retention now</Button>
          <span className="text-xs text-ink-500">Also runs nightly when pg_cron is enabled.</span>
        </div>
      </Card>

      <Card title="Support access">
        <Toggle checked={!!s.support_access_until && new Date(s.support_access_until) > new Date()} onChange={(v) => set({ support_access_until: v ? new Date(Date.now() + 72 * 3600_000).toISOString() : null })}
          label="Allow SwiftCipher support to access this school for 72 hours" description="Break-glass access is audit-logged. Leave off unless you've opened a support request." />
      </Card>

      <Card title="Feature flags">
        <p className="mb-3 text-sm text-ink-500">Your {plan.name} plan decides the defaults; you can switch features off for your school.</p>
        <div className="grid gap-3 sm:grid-cols-2">{KNOWN_FLAGS.map((f) => {
          const override = flags.find((x) => x.key === f.key && x.tenant_id);
          const planOn = Boolean(plan.features[f.key]);
          const on = override ? override.enabled : planOn;
          return <Toggle key={f.key} checked={on} disabled={!planOn} onChange={(v) => flag(f.key, v)} label={f.label} description={planOn ? (override ? "Overridden for your school" : "Plan default") : "Not included in your plan"} />;
        })}</div>
      </Card>

      <div className="sticky bottom-4 flex justify-end"><Button size="lg" loading={busy} onClick={saveAll}>Save settings</Button></div>
      <Alert>Monitoring only runs on school-managed browsers enrolled by your school, and only during live class sessions. Never use SwiftCipher to monitor personal devices.</Alert>
    </div>
  );
}
