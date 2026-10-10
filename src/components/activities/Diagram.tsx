"use client";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { uploadMedia, useSignedUrl } from "@/lib/media";
import { createClient } from "@/lib/supabase/client";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { EditableQuestion } from "./QuestionEditor";

/*
 * "Label the diagram" (migration 1090): a picture with numbered spots; students pick
 * the right label for each. config: { image_path | image_url, spots: [{id, x, y}] (percent),
 * labels: [{id, label}] }; answer_key: { placements: { spotId: labelId } }.
 */

type Spot = { id: string; x: number; y: number };
type DiagramConfig = { image_path?: string; image_url?: string; spots?: Spot[]; labels?: Item[] };
const newId = () => Math.random().toString(36).slice(2, 10);

/** The picture with its numbered spots. */
function Picture({ config, onPick, active, children }: { config: DiagramConfig; onPick?: (x: number, y: number) => void; active?: string | null; children?: React.ReactNode }) {
  const signed = useSignedUrl(config.image_url ? null : config.image_path);
  const src = config.image_url || signed;
  if (!src) return <div className="grid aspect-video place-items-center rounded-xl border border-dashed border-ink-300 bg-ink-50 text-sm text-ink-500">{config.image_path ? "Loading the picture…" : "No picture yet"}</div>;
  return (
    <div className="relative overflow-hidden rounded-xl border border-ink-200 bg-white">
      <img src={src} alt="Diagram to label" className={cn("block h-auto w-full select-none", onPick && "cursor-crosshair")} draggable={false}
        onClick={(e) => {
          if (!onPick) return;
          const r = e.currentTarget.getBoundingClientRect();
          onPick(Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, Math.round(((e.clientY - r.top) / r.height) * 1000) / 10);
        }} />
      {(config.spots ?? []).map((s, i) => (
        <span key={s.id} style={{ left: `${s.x}%`, top: `${s.y}%` }}
          className={cn("pointer-events-none absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-display text-sm font-extrabold text-white shadow ring-2 ring-white",
            active === s.id ? "bg-tile-hex" : "bg-tile-bolt")}>{i + 1}</span>
      ))}
      {children}
    </div>
  );
}

/** Teacher: the picture, spots placed by clicking, the right label for each, and extra wrong labels. */
export function DiagramEditor({ q, onChange }: { q: EditableQuestion; onChange: (q: EditableQuestion) => void }) {
  const config = q.config as DiagramConfig;
  const spots = config.spots ?? [];
  const labels = config.labels ?? [];
  const placements = (q.answer_key.placements as Record<string, string>) ?? {};
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const extras = labels.filter((l) => !Object.values(placements).includes(l.id));
  const save = (c: Partial<DiagramConfig>, key?: Record<string, string>) =>
    onChange({ ...q, config: { ...q.config, ...c }, answer_key: key ? { placements: key } : q.answer_key });

  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      const { data: me } = await sb.from("users").select("tenant_id").eq("id", user!.id).single();
      const m = await uploadMedia(file, { tenantId: me!.tenant_id as string, userId: user!.id, alt: "Diagram" });
      save({ image_path: m.storage_path, image_url: undefined });
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't upload the picture."); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" id={`diagram-${q.position}`} aria-label="Upload a picture for the diagram" tabIndex={-1} onChange={(e) => void upload(e.target.files?.[0])} />
        <Button size="sm" variant="secondary" loading={busy} onClick={() => fileRef.current?.click()}>{config.image_path || config.image_url ? "Change picture" : "Upload a picture"}</Button>
        <span className="text-[13px] text-ink-500">or</span>
        <Input className="min-w-0 flex-1" placeholder="Paste a picture's web address (https://…)" value={config.image_url ?? ""}
          onChange={(e) => save({ image_url: e.target.value.trim() || undefined, image_path: e.target.value.trim() ? undefined : config.image_path })} />
      </div>
      {err && <p className="text-sm text-rose-700">{err}</p>}
      <Picture config={config} onPick={(x, y) => {
        const id = newId(), labelId = `l${id}`;
        save({ spots: [...spots, { id, x, y }], labels: [...labels, { id: labelId, label: "" }] }, { ...placements, [id]: labelId });
      }} />
      <p className="hint">Click the picture to place a numbered spot, then type its label. Students choose the right label for each spot.</p>
      {spots.map((s, i) => {
        const labelId = placements[s.id];
        const label = labels.find((l) => l.id === labelId);
        return (
          <div key={s.id} className="flex items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-tile-bolt font-display text-sm font-extrabold text-white">{i + 1}</span>
            <Input value={label?.label ?? ""} placeholder={`Label for spot ${i + 1}`} onChange={(e) => save({ labels: labels.map((l) => (l.id === labelId ? { ...l, label: e.target.value } : l)) })} />
            <Button size="sm" variant="ghost" aria-label={`Remove spot ${i + 1}`} onClick={() => {
              const p = { ...placements }; delete p[s.id];
              save({ spots: spots.filter((x) => x.id !== s.id), labels: labels.filter((l) => l.id !== labelId) }, p);
            }}><X className="h-4 w-4" /></Button>
          </div>
        );
      })}
      <div>
        <p className="label">Extra wrong labels (optional)</p>
        <div className="space-y-2">
          {extras.map((l) => (
            <div key={l.id} className="flex items-center gap-2">
              <Input value={l.label} placeholder="A label that fits no spot" onChange={(e) => save({ labels: labels.map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)) })} />
              <Button size="sm" variant="ghost" aria-label="Remove label" onClick={() => save({ labels: labels.filter((x) => x.id !== l.id) })}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => save({ labels: [...labels, { id: `x${newId()}`, label: "" }] })}>Add a wrong label</Button>
        </div>
      </div>
    </div>
  );
}

/** Student: pick a label for each numbered spot. */
export function DiagramInput({ config, placements, onChange, disabled }: {
  config: DiagramConfig; placements: Record<string, string>; onChange: (p: Record<string, string>) => void; disabled?: boolean;
}) {
  const [active, setActive] = useState<string | null>(null);
  // Labels in a fixed order that doesn't give away which spot they belong to.
  const labels = [...(config.labels ?? [])].filter((l) => l.label.trim()).sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="space-y-3">
      <Picture config={config} active={active} />
      <ol className="grid gap-2 sm:grid-cols-2">
        {(config.spots ?? []).map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-tile-bolt font-display text-sm font-extrabold text-white" aria-hidden>{i + 1}</span>
            <Select aria-label={`Label for spot ${i + 1}`} disabled={disabled} value={placements[s.id] ?? ""}
              onFocus={() => setActive(s.id)} onBlur={() => setActive(null)}
              onChange={(e) => onChange({ ...placements, [s.id]: e.target.value })}>
              <option value="">Choose a label</option>
              {labels.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </Select>
          </li>
        ))}
      </ol>
    </div>
  );
}
