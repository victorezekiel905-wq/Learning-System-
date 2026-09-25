"use client";
import { useState } from "react";
import { Badge, Button, Card, useToast } from "@/components/ui";
import { useRpc } from "@/lib/hooks";
import { BADGE_HINT, BADGE_LABEL, CHALLENGE, type Progress } from "@/lib/progress";
import { errorText, rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/Icon";

type Board = { enabled: boolean; rows: { rank: number; name: string; xp: number; me: boolean }[] };

/** XP, level, badges, "Choose your challenge" and the class leaderboard. */
export function ProgressPanel() {
  const toast = useToast();
  const p = useRpc<Progress>("my_progress", {}, []);
  const d = p.data;
  const [classId, setClassId] = useState<string | null>(null);
  const cls = d?.classes.find((c) => c.class_id === (classId ?? d.classes[0]?.class_id)) ?? null;
  const board = useRpc<Board>("class_leaderboard", { p_class: cls?.class_id, p_period: "week" }, [cls?.class_id], { enabled: !!cls });

  if (!d) return null;
  const span = Math.max(d.next_level_xp - d.level_floor, 1);
  const into = Math.min(Math.max(d.xp - d.level_floor, 0), span);
  const earned = new Set(d.badges.map((b) => b.badge));

  async function choose(level: 1 | 2 | 3) {
    if (!cls) return;
    try {
      await rpc("choose_level", { p_class: cls.class_id, p_level: level });
      toast(`${CHALLENGE[level].name} challenge chosen for ${cls.name}`, "success");
      await p.reload();
    } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <Card title="My progress" className="mb-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="flex items-end justify-between">
            <p className="font-display text-3xl font-extrabold text-ink-900">Level {d.level}</p>
            <p className="text-sm text-ink-600"><strong>{d.xp.toLocaleString()}</strong> XP · +{d.week_xp} this week</p>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-label="Progress to next level"
               aria-valuemin={0} aria-valuemax={span} aria-valuenow={into}>
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${(into / span) * 100}%` }} />
          </div>
          <p className="text-xs text-ink-500">{(d.next_level_xp - d.xp).toLocaleString()} XP to level {d.level + 1}. Harder questions and explaining your reasoning earn more.</p>
          <ul className="flex flex-wrap gap-2" aria-label="Badges">
            {Object.keys(BADGE_LABEL).map((b) => (
              <li key={b} title={BADGE_HINT[b]}>
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                  earned.has(b) ? "border-amber-300 bg-amber-50 text-amber-900" : "border-ink-200 bg-white text-ink-500")}>
                  <Icon name={earned.has(b) ? "award" : "lock"} className="h-3.5 w-3.5" /> {BADGE_LABEL[b]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          {d.classes.length > 1 && (
            <label className="block">
              <span className="label">Class</span>
              <select className="input" value={cls?.class_id ?? ""} onChange={(e) => setClassId(e.target.value)}>
                {d.classes.map((c) => <option key={c.class_id} value={c.class_id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {cls && (
            <div>
              <p className="label">Choose your challenge{d.classes.length === 1 ? ` · ${cls.name}` : ""}</p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Challenge level">
                {([1, 2, 3] as const).map((l) => (
                  <button key={l} type="button" role="radio" aria-checked={cls.level === l} disabled={!cls.choice_enabled}
                    onClick={() => choose(l)} title={CHALLENGE[l].hint}
                    className={cn("rounded-lg border px-2 py-2 text-sm font-semibold",
                      cls.level === l ? "border-brand-600 bg-brand-600 text-white" : "border-ink-300 bg-white text-ink-700 hover:border-brand-400",
                      !cls.choice_enabled && cls.level !== l && "opacity-50")}>
                    {CHALLENGE[l].name}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-500">
                {cls.choice_enabled ? CHALLENGE[cls.level].hint + ". You can change this any time." : "Your teacher sets your challenge level in this class."}
              </p>
            </div>
          )}
        </div>

        <div>
          <p className="label">Class leaderboard · this week</p>
          {!cls ? <p className="text-sm text-ink-500">Join a class to see it.</p>
            : !board.data?.enabled ? <p className="text-sm text-ink-500">Your teacher has turned the leaderboard off for this class.</p>
            : board.data.rows.length === 0 ? <p className="text-sm text-ink-500">No XP earned yet this week. Be the first!</p>
            : (
              <ol className="space-y-1 text-sm">
                {board.data.rows.map((r) => (
                  <li key={`${r.rank}-${r.name}`} className={cn("flex items-center justify-between rounded-md px-2 py-1", r.me && "bg-brand-50 font-semibold")}>
                    <span><span className="inline-block w-6 tabular-nums text-ink-500">{r.rank}.</span>{r.name}{r.me && " (you)"}</span>
                    <span className="tabular-nums">{r.xp} XP</span>
                  </li>
                ))}
              </ol>
            )}
          {d.recent.length > 0 && (
            <details className="mt-3 text-xs text-ink-600">
              <summary className="cursor-pointer font-medium">Recent XP</summary>
              <ul className="mt-1 space-y-0.5">{d.recent.map((e, i) => <li key={i}><Badge tone="green">+{e.points}</Badge> {e.reason}</li>)}</ul>
            </details>
          )}
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => { void p.reload(); void board.reload(); }}>Refresh</Button>
        </div>
      </div>
    </Card>
  );
}
