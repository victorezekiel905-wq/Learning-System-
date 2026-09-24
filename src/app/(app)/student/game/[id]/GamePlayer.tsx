"use client";
import { useEffect, useRef, useState } from "react";
import { Countdown } from "@/components/game/Countdown";
import { BADGE, OPTION_COLORS, type GameState, type Leaderboard } from "@/components/game/types";
import { RichText } from "@/components/RichText";
import { Alert, Button, Card, Field, Input, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useRpc } from "@/lib/hooks";
import { useSignal } from "@/lib/realtime";
import { ActionError, errorText, rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";

export function GamePlayer({ gameId }: { gameId: string }) {
  const toast = useToast();
  const state = useRpc<GameState>("game_state", { p_game: gameId }, [gameId], { intervalMs: 10000 });
  const board = useRpc<Leaderboard>("game_leaderboard", { p_game: gameId, p_limit: 10 }, [gameId, state.data?.status, state.data?.current_index]);
  // Phase changes are pushed; the slow poll is only a safety net.
  useSignal(`game:${gameId}`, ["state"], () => { void state.reload(); void board.reload(); }, { debounceMs: 50 });
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [picked, setPicked] = useState<string[]>([]);
  const [sent, setSent] = useState<number | null>(null);
  const [nickname, setNickname] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const shownAt = useRef<number>(Date.now());
  const g = state.data;

  useEffect(() => setFetchedAt(Date.now()), [g?.server_now]);
  useEffect(() => { shownAt.current = Date.now(); setPicked([]); }, [g?.current_index]);

  async function join() {
    setJoinErr(null);
    const { data } = await createClient().from("game_sessions").select("join_code").eq("id", gameId).single();
    try { await rpc("join_game", { p_code: data?.join_code, p_nickname: nickname || null }); void state.reload(); }
    catch (e) { setJoinErr(errorText(e)); }
  }

  async function answer(choice: Record<string, unknown>) {
    if (!g) return;
    try {
      await rpc("game_answer", { p_game: gameId, p_index: g.current_index, p_choice: choice, p_client_elapsed_ms: Date.now() - shownAt.current });
      setSent(g.current_index);
      void state.reload();
    } catch (e) {
      if (e instanceof ActionError && /already answered/.test(e.message)) setSent(g.current_index);
      else toast(errorText(e), "error");
    }
  }

  if (state.error && !g) return <div className="page max-w-lg"><Alert tone="error">{state.error}</Alert></div>;
  if (!g) return <div className="page text-sm text-ink-500">Loading…</div>;

  if (!g.me && g.status !== "ended") {
    return (
      <div className="page max-w-md">
        <Card title={`Join "${g.title}"`}>
          <div className="space-y-3">
            {g.settings.display_mode === "nickname" && <Field label="Nickname" hint="2-20 letters or numbers. Your teacher can see your real name."><Input value={nickname} onChange={(e) => setNickname(e.target.value)} /></Field>}
            {joinErr && <Alert tone="error">{joinErr}</Alert>}
            <Button className="w-full" size="lg" onClick={join}>Join game</Button>
          </div>
        </Card>
      </div>
    );
  }

  const q = g.question;
  const answered = g.me?.answered || sent === g.current_index;
  const multi = q?.kind === "multi_select";

  return (
    <div className="page max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div><p className="text-xs font-semibold uppercase text-accent-700">Challenge</p><h1 className="text-lg font-bold">{g.title}</h1></div>
        {g.me && <div className="text-right"><p className="text-xs text-ink-500">{g.me.name}</p><p className="font-display text-2xl font-extrabold tabular-nums">{g.me.score}</p>{g.me.streak > 1 && <p className="text-xs font-semibold text-orange-600">🔥 {g.me.streak} streak</p>}</div>}
      </div>

      {g.status === "lobby" && <Card><p className="py-10 text-center text-lg">You're in! Waiting for your teacher to start…</p></Card>}

      {g.status === "question" && q && (
        <Card>
          <p className="mb-1 text-sm text-ink-500">Question {g.current_index + 1} of {g.total}</p>
          <RichText text={q.prompt} className="text-xl font-bold" />
          <Countdown className="my-4" endsAt={g.question_ends_at} serverNow={g.server_now} fetchedAt={fetchedAt} total={g.settings.question_seconds} />
          {answered ? <p className="py-8 text-center text-lg font-semibold text-brand-700">Answer locked in. Waiting for the others…</p> : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {q.options.map((o, i) => (
                  <button key={o.id} onClick={() => multi ? setPicked((p) => p.includes(o.id) ? p.filter((x) => x !== o.id) : [...p, o.id]) : answer({ option_id: o.id })}
                    className={cn("rounded-xl px-5 py-6 text-left text-lg font-semibold text-white shadow transition active:scale-[.98]", OPTION_COLORS[i % OPTION_COLORS.length], multi && picked.includes(o.id) && "ring-4 ring-ink-900")}>
                    {o.label}
                  </button>
                ))}
              </div>
              {multi && <Button className="mt-3 w-full" size="lg" disabled={!picked.length} onClick={() => answer({ option_ids: picked })}>Submit</Button>}
            </>
          )}
        </Card>
      )}

      {g.status === "review" && (
        <Card>
          {g.me?.last ? (
            <div className={cn("rounded-xl p-6 text-center text-white", g.me.last.is_correct ? "bg-emerald-600" : "bg-rose-600")}>
              <p className="font-display text-3xl font-extrabold">{g.me.last.is_correct ? "Correct!" : "Not this time"}</p>
              <p className="mt-1 text-lg">+{g.me.last.points} points</p>
            </div>
          ) : <p className="text-center text-ink-500">No answer this round.</p>}
          {g.review?.explanation && <p className="mt-3 text-sm text-ink-600">{g.review.explanation}</p>}
        </Card>
      )}

      {board.data && (g.status === "review" || g.status === "ended") && (
        <Card title={g.status === "ended" ? "Final results" : "Standings"}>
          {board.data.me && <p className="mb-3 text-lg">You are <strong>#{board.data.me.rank}</strong> of {board.data.players} with <strong>{board.data.me.score}</strong> points.</p>}
          {board.data.visible ? (
            <ol className="space-y-1">{board.data.top.map((p) => (
              <li key={p.player_id} className={cn("flex justify-between rounded-lg px-3 py-1.5", p.player_id === board.data!.me?.player_id ? "bg-brand-50 font-semibold" : "")}>
                <span>{p.rank}. {p.name}</span><span className="tabular-nums">{p.score}</span></li>
            ))}</ol>
          ) : <p className="text-sm text-ink-500">Your teacher has hidden the full leaderboard. Only you can see your position.</p>}
          {g.status === "ended" && !!board.data.me?.badges.length && (
            <div className="mt-4 flex flex-wrap gap-2">{board.data.me.badges.map((b) => <span key={b} className="badge bg-amber-100 text-amber-900">{BADGE[b] ?? b}</span>)}</div>
          )}
        </Card>
      )}
    </div>
  );
}
