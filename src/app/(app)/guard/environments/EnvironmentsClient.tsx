"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Tabs, Textarea, Toggle, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES, type EnvironmentPolicy } from "@/lib/types";
import { splitList } from "@/lib/utils";

type Scene = { id: string; name: string; description: string | null; policy_id: string; owner_id: string; scene_rules: { id: string; rule_type: string; value: string | null; position: number }[] };
type Me = { id: string; tenantId: string; isIt: boolean };

const BLANK: Omit<EnvironmentPolicy, "id" | "owner_id"> = {
  name: "", description: null, allowed_domains: [], blocked_domains: [], blocked_categories: ["games", "social"], required_urls: [], lesson_url: null,
  focus_mode: false, lock_screen: false, tab_limit: null, grace_seconds: 15, idle_seconds: 300, subject: null,
  notify: { banner: true, sound: false, browser: false, email: false }, is_template: false
};

export function EnvironmentsClient({ policies, scenes, me, initialTab }: { policies: EnvironmentPolicy[]; scenes: Scene[]; me: Me; initialTab: "policies" | "scenes" }) {
  const [tab, setTab] = useState(initialTab);
  const [editing, setEditing] = useState<Partial<EnvironmentPolicy> | null>(null);
  const [scene, setScene] = useState<Partial<Scene> | null>(null);
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "policies", label: `Environments (${policies.length})` }, { id: "scenes", label: `Scenes (${scenes.length})` }]} />
        {tab === "policies" ? <Button onClick={() => setEditing({ ...BLANK })}>New environment</Button> : <Button onClick={() => setScene({ name: "", policy_id: policies[0]?.id, scene_rules: [] })} disabled={!policies.length}>New scene</Button>}
      </div>

      {tab === "policies" && (policies.length === 0 ? <Empty title="No environments yet">Start with a lesson environment: allow your class resources and block games and social media.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {policies.map((p) => (
            <Card key={p.id} title={<span className="flex items-center gap-2">{p.name}{p.is_template && <Badge tone="cyan">template</Badge>}</span>}
              actions={(p.owner_id === me.id || me.isIt) && <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button>}>
              <div className="space-y-2 text-sm">
                {p.description && <p className="text-ink-600">{p.description}</p>}
                <p><span className="font-medium text-emerald-700">Allowed:</span> {[...p.allowed_domains, ...(p.lesson_url ? [p.lesson_url] : [])].join(", ") || "—"}</p>
                <p><span className="font-medium text-rose-700">Blocked:</span> {[...p.blocked_domains, ...p.blocked_categories.map((c) => `#${c}`)].join(", ") || "—"}</p>
                <div className="flex flex-wrap gap-1">
                  {p.focus_mode && <Badge tone="brand">Focus mode</Badge>}{p.lock_screen && <Badge tone="brand">Lock</Badge>}
                  {p.tab_limit && <Badge>≤ {p.tab_limit} tabs</Badge>}<Badge>grace {p.grace_seconds}s</Badge><Badge>idle {Math.round(p.idle_seconds / 60)}m</Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ))}

      {tab === "scenes" && (scenes.length === 0 ? <Empty title="No scenes yet">A scene applies an environment and runs actions, such as opening the lesson tab or focusing a page, in one click.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {scenes.map((s) => (
            <Card key={s.id} title={s.name} actions={(s.owner_id === me.id || me.isIt) && <Button size="sm" variant="ghost" onClick={() => setScene(s)}>Edit</Button>}>
              <p className="text-sm">Environment: <strong>{policies.find((p) => p.id === s.policy_id)?.name}</strong></p>
              <ul className="mt-2 space-y-1 text-sm text-ink-600">{[...s.scene_rules].sort((a, b) => a.position - b.position).map((r) => <li key={r.id}>• {r.rule_type.replace(/_/g, " ")}{r.value && `: ${r.value}`}</li>)}</ul>
            </Card>
          ))}
        </div>
      ))}

      {editing && <PolicyEditor value={editing} me={me} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}
      {scene && <SceneEditor value={scene} policies={policies} me={me} onClose={() => setScene(null)} onSaved={() => { setScene(null); router.refresh(); }} />}
    </div>
  );
}

function PolicyEditor({ value, me, onClose, onSaved }: { value: Partial<EnvironmentPolicy>; me: Me; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [p, setP] = useState(value);
  const [allowed, setAllowed] = useState((value.allowed_domains ?? []).join("\n"));
  const [blocked, setBlocked] = useState((value.blocked_domains ?? []).join("\n"));
  const [required, setRequired] = useState((value.required_urls ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EnvironmentPolicy>) => setP({ ...p, ...patch });

  async function save() {
    setBusy(true);
    const row = {
      name: p.name?.trim(), description: p.description || null, allowed_domains: splitList(allowed), blocked_domains: splitList(blocked),
      blocked_categories: p.blocked_categories ?? [], required_urls: splitList(required), lesson_url: p.lesson_url || null,
      focus_mode: !!p.focus_mode, lock_screen: !!p.lock_screen, tab_limit: p.tab_limit || null, grace_seconds: p.grace_seconds ?? 15,
      idle_seconds: p.idle_seconds ?? 300, subject: p.subject || null, notify: p.notify, is_template: !!p.is_template
    };
    const sb = createClient();
    const { error } = p.id ? await sb.from("environment_policies").update(row).eq("id", p.id)
      : await sb.from("environment_policies").insert({ ...row, tenant_id: me.tenantId, owner_id: me.id });
    setBusy(false);
    if (error) toast(error.message, "error"); else { toast("Environment saved (change recorded in the audit log)", "success"); onSaved(); }
  }
  async function del() {
    if (!p.id || !confirm("Delete this environment? Sessions using it stop enforcing it.")) return;
    const { error } = await createClient().from("environment_policies").delete().eq("id", p.id);
    if (error) toast(error.message, "error"); else onSaved();
  }

  return (
    <Modal open onClose={onClose} wide title={p.id ? "Edit environment" : "New environment"}
      footer={<>{p.id && <Button variant="ghost" className="mr-auto text-rose-600" onClick={del}>Delete</Button>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!p.name?.trim()} onClick={save}>Save</Button></>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name"><Input value={p.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="HTML lesson environment" /></Field>
        <Field label="Subject (for off-task alerts)"><Input value={p.subject ?? ""} onChange={(e) => set({ subject: e.target.value })} placeholder="ICT" /></Field>
        <Field label="Description" className="md:col-span-2"><Input value={p.description ?? ""} onChange={(e) => set({ description: e.target.value })} /></Field>
        <Field label="Allowed domains" hint="One per line, e.g. docs.google.com. Subdomains are included."><Textarea rows={5} value={allowed} onChange={(e) => setAllowed(e.target.value)} /></Field>
        <Field label="Blocked domains" hint="Always a violation, even in monitor-only mode."><Textarea rows={5} value={blocked} onChange={(e) => setBlocked(e.target.value)} /></Field>
        <Field label="Required resources" hint="Pages students should keep open."><Textarea rows={3} value={required} onChange={(e) => setRequired(e.target.value)} /></Field>
        <Field label="Lesson URL"><Input value={p.lesson_url ?? ""} onChange={(e) => set({ lesson_url: e.target.value })} placeholder="https://lesson.school.org/html" /></Field>
        <div className="md:col-span-2">
          <p className="label">Blocked categories</p>
          <div className="flex flex-wrap gap-2">{CATEGORIES.map((c) => {
            const on = (p.blocked_categories ?? []).includes(c);
            return <button key={c} type="button" onClick={() => set({ blocked_categories: on ? p.blocked_categories!.filter((x) => x !== c) : [...(p.blocked_categories ?? []), c] })}
              className={`badge border capitalize ${on ? "border-rose-300 bg-rose-50 text-rose-800" : "border-ink-200 bg-white text-ink-600"}`}>{on ? "✕ " : "+ "}{c}</button>;
          })}</div>
        </div>
        <div className="space-y-3">
          <Toggle checked={!!p.focus_mode} onChange={(v) => set({ focus_mode: v })} label="Focus mode" description="Anything not allowed or required counts as leaving the environment." />
          <Toggle checked={!!p.lock_screen} onChange={(v) => set({ lock_screen: v })} label="Lock to lesson" description="The extension keeps students on allowed pages." />
          <Toggle checked={!!p.is_template} onChange={(v) => set({ is_template: v })} label="School template" description="Visible to all staff as a starting point." />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Grace (s)"><Input type="number" min={0} max={600} value={p.grace_seconds ?? 15} onChange={(e) => set({ grace_seconds: Number(e.target.value) })} /></Field>
          <Field label="Idle after (s)"><Input type="number" min={30} max={7200} value={p.idle_seconds ?? 300} onChange={(e) => set({ idle_seconds: Number(e.target.value) })} /></Field>
          <Field label="Max tabs"><Input type="number" min={0} max={50} value={p.tab_limit ?? 0} onChange={(e) => set({ tab_limit: Number(e.target.value) || null })} /></Field>
        </div>
        <div className="md:col-span-2">
          <p className="label">Teacher notifications</p>
          <div className="flex flex-wrap gap-4 text-sm">{(["banner", "sound", "browser", "email"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 capitalize"><input type="checkbox" checked={!!p.notify?.[k]} onChange={(e) => set({ notify: { ...BLANK.notify, ...p.notify, [k]: e.target.checked } })} />{k}</label>
          ))}</div>
        </div>
      </div>
      <div className="mt-4"><Alert>The extension reports state and the server applies these rules. If the extension disconnects, teachers see "connection lost", never a violation.</Alert></div>
    </Modal>
  );
}

const RULE_TYPES = [
  { v: "open_tab", label: "Open a tab", needs: "URL" }, { v: "focus", label: "Focus on page", needs: "URL" },
  { v: "lock", label: "Lock screen", needs: null }, { v: "close_other_tabs", label: "Close other tabs", needs: null },
  { v: "message", label: "Show message", needs: "Text" }
];

function SceneEditor({ value, policies, me, onClose, onSaved }: { value: Partial<Scene>; policies: EnvironmentPolicy[]; me: Me; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [s, setS] = useState(value);
  const [rules, setRules] = useState((value.scene_rules ?? []).sort((a, b) => a.position - b.position).map((r) => ({ rule_type: r.rule_type, value: r.value ?? "" })));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const sb = createClient();
    const row = { name: s.name?.trim(), description: s.description || null, policy_id: s.policy_id };
    const res = s.id ? await sb.from("scenes").update(row).eq("id", s.id).select("id").single()
      : await sb.from("scenes").insert({ ...row, tenant_id: me.tenantId, owner_id: me.id }).select("id").single();
    if (res.error) { toast(res.error.message, "error"); setBusy(false); return; }
    const id = res.data.id;
    await sb.from("scene_rules").delete().eq("scene_id", id);
    if (rules.length) {
      const { error } = await sb.from("scene_rules").insert(rules.map((r, i) => ({ tenant_id: me.tenantId, scene_id: id, rule_type: r.rule_type, value: r.value || null, position: i })));
      if (error) { toast(error.message, "error"); setBusy(false); return; }
    }
    setBusy(false);
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={s.id ? "Edit scene" : "New scene"}
      footer={<>{s.id && <Button variant="ghost" className="mr-auto text-rose-600" onClick={async () => { await createClient().from("scenes").delete().eq("id", s.id!); onSaved(); }}>Delete</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!s.name?.trim() || !s.policy_id} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name"><Input value={s.name ?? ""} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Coding sprint" /></Field>
        <Field label="Environment"><Select value={s.policy_id ?? ""} onChange={(e) => setS({ ...s, policy_id: e.target.value })}>{policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <div className="space-y-2">
          <p className="label">Actions when applied</p>
          {rules.map((r, i) => {
            const meta = RULE_TYPES.find((t) => t.v === r.rule_type);
            return (
              <div key={i} className="flex gap-2">
                <Select aria-label={`Rule ${i + 1} type`} className="w-44" value={r.rule_type} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, rule_type: e.target.value } : x))}>{RULE_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</Select>
                {meta?.needs && <Input placeholder={meta.needs} value={r.value} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />}
                <Button size="sm" variant="ghost" onClick={() => setRules(rules.filter((_, j) => j !== i))}>✕</Button>
              </div>
            );
          })}
          <Button size="sm" variant="secondary" onClick={() => setRules([...rules, { rule_type: "open_tab", value: "https://" }])}>Add action</Button>
        </div>
      </div>
    </Modal>
  );
}
