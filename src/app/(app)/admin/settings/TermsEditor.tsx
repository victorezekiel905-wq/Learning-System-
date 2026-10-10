"use client";
import { useState } from "react";
import { Button, Card, Input, useDialog, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { errorText, must } from "@/lib/rpc";
import { LOCALE } from "@/lib/utils";

type Term = { id: string; school_year: string; name: string; starts_on: string; ends_on: string };
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(LOCALE, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** The school year and its terms: progress reports for students and parents use them. */
export function TermsEditor({ tenantId }: { tenantId: string }) {
  const toast = useToast();
  const dialog = useDialog();
  const terms = useLoader(async () => must(await createClient().from("school_terms").select("id,school_year,name,starts_on,ends_on").order("starts_on")) as Term[], []);
  const list = terms.data ?? [];
  const last = list.at(-1);
  const [draft, setDraft] = useState<Omit<Term, "id">>({ school_year: "", name: "", starts_on: "", ends_on: "" });
  const year = draft.school_year || last?.school_year || suggestYear();
  const name = draft.name || nextName(list.filter((t) => t.school_year === year).length);

  async function add() {
    if (!draft.starts_on || !draft.ends_on) { toast("Choose the first and last day of the term.", "error"); return; }
    try {
      must(await createClient().from("school_terms").insert({ tenant_id: tenantId, school_year: year.trim(), name: name.trim(), starts_on: draft.starts_on, ends_on: draft.ends_on }));
      setDraft({ school_year: "", name: "", starts_on: "", ends_on: "" });
      toast("Term added", "success");
      void terms.reload();
    } catch (e) { toast(errorText(e), "error"); }
  }
  async function remove(t: Term) {
    if (!(await dialog.confirm({ title: `Remove ${t.name}, ${t.school_year}?`, body: "Lessons and answers are kept. Only the term's dates are removed.", tone: "danger", confirmLabel: "Remove" }))) return;
    try { must(await createClient().from("school_terms").delete().eq("id", t.id)); void terms.reload(); } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div id="terms" className="scroll-mt-20">
      <Card title="Terms and school year">
        <p className="mb-4 text-sm text-ink-600">Students, parents and teachers see progress for each term and the whole school year. Enter each term's first and last day.</p>
        {list.length > 0 && (
          <ul className="mb-4 divide-y divide-ink-100 rounded-xl border border-ink-200">
            {list.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span><span className="font-semibold text-ink-900">{t.name}</span> <span className="text-ink-500">· {t.school_year}</span></span>
                <span className="flex items-center gap-3"><span className="tabular-nums text-ink-700">{fmt(t.starts_on)} – {fmt(t.ends_on)}</span>
                  <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(t)}>Remove</Button></span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
          <label className="block text-sm"><span className="mb-1 block font-medium text-ink-700">School year</span>
            <Input value={draft.school_year} placeholder={year} onChange={(e) => setDraft({ ...draft, school_year: e.target.value })} /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-ink-700">Term</span>
            <Input value={draft.name} placeholder={name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-ink-700">First day</span>
            <Input type="date" value={draft.starts_on} onChange={(e) => setDraft({ ...draft, starts_on: e.target.value })} /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-ink-700">Last day</span>
            <Input type="date" value={draft.ends_on} min={draft.starts_on || undefined} onChange={(e) => setDraft({ ...draft, ends_on: e.target.value })} /></label>
          <Button onClick={add}>Add term</Button>
        </div>
      </Card>
    </div>
  );
}

function suggestYear() {
  const d = new Date();
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}/${y + 1}`;
}
function nextName(n: number) {
  return ["First term", "Second term", "Third term"][n] ?? `Term ${n + 1}`;
}
