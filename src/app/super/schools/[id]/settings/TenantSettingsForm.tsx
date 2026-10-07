"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, Card, Field, Input, Select, Textarea, Toggle, useToast } from "@/components/ui";
import { rpc } from "@/lib/rpc";

export type SaSettings = {
  monitoring_enabled: boolean;
  allow_spotlight: boolean; allow_group_chat: boolean; allow_screen_capture: boolean; store_event_screenshots: boolean;
  parent_portal_enabled: boolean; email_alerts_enabled: boolean; parent_focus_details: boolean; require_monitoring_consent: boolean;
  nickname_mode: "first_name_initial" | "approved_nickname" | "anonymous";
  learning_retention_days: number; telemetry_retention_days: number;
  default_grace_seconds: number; default_idle_seconds: number; thumbnail_interval_seconds: number;
  monitoring_notice: string; brand_name: string | null; brand_primary: string | null; brand_accent: string | null;
  welcome_message: string | null; timezone: string;
};

type Key = keyof SaSettings;

/** Every setting a school admin can change, editable by the super admin. Only changed values are sent. */
export function TenantSettingsForm({ tenantId, initial }: { tenantId: string; initial: SaSettings }) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [s, setS] = useState(initial);
  const set = <K extends Key>(k: K, v: SaSettings[K]) => setS((p) => ({ ...p, [k]: v }));
  const changed = useMemo(() => (Object.keys(s) as Key[]).filter((k) => (s[k] ?? "") !== (saved[k] ?? "")), [s, saved]);
  const zones = useMemo(() => { try { return Intl.supportedValuesOf("timeZone"); } catch { return []; } }, []);

  const num = (k: Key, label: string, min: number, max: number, hint: string) => (
    <Field label={label} hint={`${hint} (${min}–${max})`}>
      <Input type="number" min={min} max={max} value={String(s[k])} onChange={(e) => set(k, Number(e.target.value) as never)} />
    </Field>
  );
  const flag = (k: Key, label: string, description: string) => (
    <Toggle checked={Boolean(s[k])} onChange={(v) => set(k, v as never)} label={label} description={description} />
  );

  async function save() {
    const changes = Object.fromEntries(changed.map((k) => [k, s[k] ?? ""]));
    const next = await rpc<SaSettings>("sa_update_tenant_settings", { p_tenant: tenantId, p_changes: changes });
    setSaved(next); setS(next);
    toast(`Saved ${changed.length} setting${changed.length === 1 ? "" : "s"}`, "success");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card title="Live lessons">
        <div className="space-y-4">
          {flag("monitoring_enabled", "Classroom monitoring (add-on)", "Lockdown, students' screens, leave alerts and blocked sites. Off: live lessons without monitoring.")}
          {flag("allow_screen_capture", "Students share their screen in lessons", "Teachers see each student's screen during live lessons.")}
          {flag("store_event_screenshots", "Keep the screen picture with a leave alert", "Otherwise every screen picture is deleted when the class ends.")}
          {flag("allow_spotlight", "Spotlight", "Teachers can show one student's screen to the class.")}
          {flag("allow_group_chat", "Class group chat", "Students can chat with the whole class during a lesson.")}
          <div className="grid gap-4 sm:grid-cols-3">
            {num("default_grace_seconds", "Grace period (seconds)", 0, 600, "Away this long before a leave alert")}
            {num("default_idle_seconds", "Idle after (seconds)", 30, 7200, "No activity this long counts as idle")}
            {num("thumbnail_interval_seconds", "Screen refresh (seconds)", 5, 300, "How often screen pictures update")}
          </div>
        </div>
      </Card>

      <Card title="Parents">
        <div className="space-y-4">
          {flag("parent_portal_enabled", "Parent portal", "Parents can sign in to see their children's reports.")}
          {flag("parent_focus_details", "Show parents what happened when a child left a lesson", "Off: parents see counts only.")}
          {flag("require_monitoring_consent", "Require parental monitoring consent", "A student's screen is only shared once a parent's consent is on record.")}
          {flag("email_alerts_enabled", "Email alerts", "Send alerts by email as well as in the app.")}
        </div>
      </Card>

      <Card title="Privacy">
        <div className="space-y-4">
          <Field label="Names in games">
            <Select value={s.nickname_mode} onChange={(e) => set("nickname_mode", e.target.value as SaSettings["nickname_mode"])}>
              <option value="first_name_initial">First name and last initial</option>
              <option value="approved_nickname">Nicknames approved by the teacher</option>
              <option value="anonymous">Anonymous</option>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {num("learning_retention_days", "Keep learning records (days)", 30, 3650, "Answers, grades and reports")}
            {num("telemetry_retention_days", "Keep focus records (days)", 1, 365, "Leave events and device signals")}
          </div>
          <Field label="Notice shown on monitored devices">
            <Textarea rows={3} value={s.monitoring_notice} onChange={(e) => set("monitoring_notice", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="School and branding">
        <div className="space-y-4">
          <Field label="Time zone" hint="Used for reports, due dates and the weekly parent summary.">
            <Input list="sa-zones" value={s.timezone} onChange={(e) => set("timezone", e.target.value)} />
            <datalist id="sa-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          </Field>
          <Field label="Display name" hint="Optional. Shown instead of the school's name in the app."><Input maxLength={80} value={s.brand_name ?? ""} onChange={(e) => set("brand_name", e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Main colour" hint="Hex, e.g. #2340D3. Empty for the default."><Input value={s.brand_primary ?? ""} placeholder="#2340D3" onChange={(e) => set("brand_primary", e.target.value)} /></Field>
            <Field label="Accent colour" hint="Hex, e.g. #C8F03C. Empty for the default."><Input value={s.brand_accent ?? ""} placeholder="#C8F03C" onChange={(e) => set("brand_accent", e.target.value)} /></Field>
          </div>
          <Field label="Welcome message" hint="Up to 500 characters."><Textarea rows={2} maxLength={500} value={s.welcome_message ?? ""} onChange={(e) => set("welcome_message", e.target.value)} /></Field>
          <p className="text-[13px] text-ink-500">The logo and support access are left to the school&apos;s own admins.</p>
        </div>
      </Card>

      <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-2xl border border-ink-200 bg-white/95 p-3 backdrop-blur">
        <span className="mr-auto text-sm text-ink-600">{changed.length ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}` : "No changes"}</span>
        <Button variant="ghost" disabled={!changed.length} onClick={() => setS(saved)}>Undo</Button>
        <Button disabled={!changed.length} onClick={save}>Save changes</Button>
      </div>
    </div>
  );
}
