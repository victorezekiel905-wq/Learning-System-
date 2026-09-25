"use client";
import { useEffect, useState } from "react";
import { Countdown } from "@/components/game/Countdown";
import { GoalBar } from "@/components/game/GoalBar";
import { OptionShape } from "@/components/game/Shape";
import { Lock, LockOpen, Pencil, X } from "lucide-react";
import { BADGE, OPTION_COLORS, type GameState, type Leaderboard } from "@/components/game/types";
import { RichText } from "@/components/RichText";
import { Alert, Badge, Button, Card, useToast, useDialog } from "@/components/ui";
import { useRpc } from "@/lib/hooks";
import { useSignal } from "@/lib/realtime";
import { errorText, rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";

export function GameHost({ gameId, school }: { gameId: string; school: string }) {
  const toast = useToast();
  const dialog = useDialog();
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const state = useRpc<GameState>("game_state", { p_game: gameId }, [gameId], { intervalMs: 10000 });
  const board = useRpc<Leaderboard>("game_leaderboard", { p_game: gameId, p_limit: 50 }, [gameId, state.data?.status, state.data?.current_index]);
  useSignal(`game:${gameId}`, ["state", "players"], () => { void state.reload(); void board.reload(); }, { debounceMs: 100, minGapMs: 1000 });
  useEffect(() => setFetchedAt(Date.now()), [state.data?.server_now]);
  const g = state.data;

  async function control(action: string) {
    try { await rpc("game_control", { p_game: gameId, p_action: action }); await state.reload(); await board.reload(); }
    catch (e) { toast(errorText(e), "error"); }
  }
  async function moderate(player: string, action: "rename" | "remove") {
    const name = action === "rename" ? await dialog.ask({ title: "Rename player", label: "New display name", maxLength: 20, confirmLabel: "Rename" }) : null;
    if (action === "rename" && !name) return;
    if (action === "remove" && !(await dialog.confirm({ title: "Remove this player?", body: "They're taken out of this game.", tone: "danger", confirmLabel: "Remove" }))) return;
    try { await rpc("game_moderate_player", { p_player: player, p_action: action, p_name: name }); void state.reload(); }
    catch (e) { toast(errorText(e), "error"); }
  }

  if (state.error && !g) return <div className="page"><Alert tone="error">{state.error}</Alert></div>;
  if (!g) return <div className="page text-sm text-ink-500">Loading game…</div>;
  const q = g.question;

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[13px] font-semibold text-ink-500">SwiftCipher Challenge</p><h1 className="text-2xl font-bold">{g.title}</h1></div>
        <div className="flex items-center gap-4">
          {g.status !== "ended" && <div className="text-center"><p className="text-[11px] font-semibold text-ink-500">Join code</p><p className="font-mono text-3xl font-extrabold tracking-[0.2em] text-brand-700">{g.join_code}</p></div>}
          <div className="text-center"><p className="text-[11px] font-semibold text-ink-500">Players</p><p className="font-display text-2xl font-bold">{g.players}</p></div>
          {!!g.flags && <Badge tone="amber" className="self-center">{g.flags} pattern flag(s)</Badge>}
          {g.status !== "ended" && (
            <Button variant={g.settings.locked ? "ink" : "secondary"} aria-pressed={!!g.settings.locked}
              title={g.settings.locked ? "No one new can join. Players already in stay in." : "Stop anyone else joining with the code"}
              onClick={() => control(g.settings.locked ? "unlock" : "lock")}>
              {g.settings.locked ? <Lock className="h-4 w-4" aria-hidden /> : <LockOpen className="h-4 w-4" aria-hidden />}
              {g.settings.locked ? "Game locked" : "Lock game"}
            </Button>
          )}
        </div>
      </div>

      {g.status === "lobby" && (
        <Card title="Lobby" actions={<Button size="lg" disabled={!g.players} onClick={() => control("start")}>Start game</Button>}>
          <p className="mb-3 text-sm text-ink-500">Students join at <strong>/student/join</strong> with code <strong className="font-mono">{g.join_code}</strong>.</p>
          <div className="flex flex-wrap gap-2">
            {(g.roster ?? []).map((p) => (
              <span key={p.player_id} className="inline-flex items-center gap-0.5 rounded-full border border-ink-200 bg-white py-1 pl-3 pr-1 text-sm font-medium text-ink-900" title={p.full_name}>
                {p.name}
                <button className="grid h-6 w-6 place-items-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label={`Rename ${p.name}`} onClick={() => moderate(p.player_id, "rename")}><Pencil className="h-3 w-3" aria-hidden /></button>
                <button className="grid h-6 w-6 place-items-center rounded-full text-rose-700 hover:bg-rose-50" aria-label={`Remove ${p.name}`} onClick={() => moderate(p.player_id, "remove")}><X className="h-3.5 w-3.5" aria-hidden /></button>
              </span>
            ))}
            {!g.players && <p className="text-sm text-ink-500">Waiting for players…</p>}
          </div>
        </Card>
      )}

      {g.settings.class_goal && g.status !== "lobby" && <GoalBar gameId={gameId} refreshKey={`${g.status}-${g.current_index}-${g.answered}`} />}

      {(g.status === "question" || g.status === "review") && q && (
        <Card>
          <div className="mb-3 flex items-center justify-between text-sm text-ink-500"><span>Question {g.current_index + 1} of {g.total}</span><span>{g.answered}/{g.players} answered</span></div>
          <RichText text={q.prompt} className="text-2xl font-bold text-ink-900" />
          {g.status === "question" && <Countdown className="my-4" endsAt={g.question_ends_at} serverNow={g.server_now} fetchedAt={fetchedAt} total={g.settings.question_seconds} />}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {q.options.map((o, i) => {
              const correct = g.review?.correct_option_ids.includes(o.id);
              const count = g.review?.distribution[o.id] ?? 0;
              return (
                <div key={o.id} className={cn("flex items-center justify-between rounded-xl px-5 py-4 text-lg font-semibold text-white", OPTION_COLORS[i % OPTION_COLORS.length], g.status === "review" && !correct && "opacity-40")}>
                  <span className="flex items-center gap-3"><OptionShape i={i} />{o.label}{correct && <span className="sr-only"> (correct)</span>}</span>{g.status === "review" && <span className="rounded-full bg-black/20 px-2 text-sm">{count}</span>}
                </div>
              );
            })}
          </div>
          {g.review?.explanation && <Alert tone="info">{g.review.explanation}</Alert>}
          <div className="mt-5 flex justify-end gap-2">
            {g.status === "question" && <Button variant="secondary" onClick={() => control("close")}>Close answers</Button>}
            <Button onClick={() => control("next")}>{g.current_index + 1 >= g.total && g.status === "review" ? "Finish" : "Next question"}</Button>
          </div>
        </Card>
      )}

      {(g.status === "review" || g.status === "ended") && board.data && !(g.settings.class_goal && g.status === "review") && <Standings board={board.data} ended={g.status === "ended"} school={school} title={g.title} certificates={g.settings.certificates} />}

      {g.status !== "ended" && g.status !== "lobby" && <div className="text-right"><Button variant="ghost" onClick={async () => { if (await dialog.confirm({ title: "End the game now?", body: "Final scores and badges go to everyone who played.", tone: "danger", confirmLabel: "End game" })) await control("end"); }}>End game</Button></div>}
    </div>
  );
}

function Standings({ board, ended, school, title, certificates }: { board: Leaderboard; ended: boolean; school: string; title: string; certificates: boolean }) {
  const podium = board.top.slice(0, 3);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {ended && podium.length > 0 && (
        <Card title="Podium">
          <div className="flex items-end justify-center gap-4 pt-4">
            {[1, 0, 2].map((i) => podium[i] && (
              <div key={podium[i]!.player_id} className="text-center">
                <p className="font-bold">{podium[i]!.name}</p><p className="text-sm text-ink-500">{podium[i]!.score}</p>
                <div className={cn("mt-2 w-24 rounded-t-xl ", i === 0 ? "bg-accent-500" : "bg-ink-900", i === 0 ? "h-32" : i === 1 ? "h-24" : "h-16")} />
              </div>
            ))}
          </div>
        </Card>
      )}
      {board.teams && (
        <Card title="Teams">
          <ul className="space-y-2">{board.teams.map((t) => (
            <li key={t.team_id} className="flex items-center justify-between"><span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: t.color }} />{t.name} ({t.members})</span><span className="font-bold tabular-nums">{t.score}</span></li>
          ))}</ul>
        </Card>
      )}
      <Card title="Leaderboard" pad={false}>
        <table className="table"><thead><tr><th>#</th><th>Player</th><th>Score</th><th>Correct</th><th>Best streak</th>{ended && <th>Badges</th>}</tr></thead>
          <tbody>{board.top.map((p) => (
            <tr key={p.player_id}><td className="font-bold">{p.rank}</td><td>{p.name}</td><td className="tabular-nums">{p.score}</td><td>{p.correct}</td><td>{p.streak}</td>
              {ended && <td className="text-xs">{p.badges.map((b) => BADGE[b] ?? b).join(" · ")}</td>}</tr>
          ))}</tbody></table>
      </Card>
      {ended && certificates && (
        <Card title="Certificates">
          <p className="mb-3 text-sm text-ink-500">Print certificates for the podium and badge winners.</p>
          <Button variant="secondary" onClick={() => {
            // Same-origin blank window we write into ourselves (noopener would return null).
            const w = window.open("", "_blank", "width=900,height=700");
            if (!w) return;
            const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
            w.document.write(`<title>Certificates</title><style>body{font-family:system-ui;margin:0}.c{page-break-after:always;border:12px double #151411;margin:24px;padding:48px;text-align:center}h1{font-size:40px;margin:0 0 8px}p{font-size:20px}</style>` +
              board.top.filter((p) => p.badges.length).map((p) => `<div class="c"><p>${esc(school)}</p><h1>Certificate of Achievement</h1><p>awarded to</p><h2 style="font-size:34px">${esc(p.name)}</h2><p>${p.badges.map((b) => esc(BADGE[b] ?? b)).join(" · ")}</p><p>in the Challenge "${esc(title)}", with ${p.score} points</p><p>${new Date().toLocaleDateString()}</p></div>`).join(""));
            w.document.close(); w.print();
          }}>Print certificates</Button>
        </Card>
      )}
    </div>
  );
}
