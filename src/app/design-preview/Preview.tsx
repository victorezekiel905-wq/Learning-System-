"use client";
import { AnswerBars, AnswerResult, AnswerTiles, StreakChip } from "@/components/game/LiveGame";
import { GlyphField, Podium } from "@/components/game/Celebrate";
import { Leaderboard } from "@/components/live/Leaderboard";
import { EndScreen, Lobby } from "@/components/live/StudentPhases";

const OPTIONS = [{ id: "a", label: "The Moon" }, { id: "b", label: "The Sun" }, { id: "c", label: "A mirror" }, { id: "d", label: "A window" }];
const BOARD = [
  { name: "Ada O.", avatar: "fox", score: 4860, rank: 1 }, { name: "Tobi B.", avatar: "panda", score: 4410, rank: 2 },
  { name: "Kemi E.", avatar: "owl", score: 3990, rank: 3 }, { name: "Femi A.", avatar: "lion", score: 3720, rank: 4, delta: 2 },
  { name: "Zara M.", avatar: "frog", score: 3105, rank: 5, delta: -1 }
];

/** Example game screens (see page.tsx). Sections are anchored so screenshots can target one. */
export function Preview() {
  return (
    <div className="space-y-0">
      <section id="phone" className="mx-auto max-w-md space-y-5 bg-ink-50 p-5">
        <p className="text-[13px] font-semibold text-ink-600">Basic Science · Question 3 of 8</p>
        <div className="rounded-2xl bg-white p-4 text-xl font-bold text-ink-900 shadow-sm">Which of these gives out its own light?</div>
        <AnswerTiles options={OPTIONS} picked={["b"]} onPick={() => {}} />
        <div className="flex gap-2"><StreakChip streak={2} /><StreakChip streak={4} /></div>
      </section>

      <section id="results" className="mx-auto grid max-w-3xl gap-5 bg-ink-50 p-5 sm:grid-cols-2">
        <AnswerResult correct points={1280} extras="fast +280 · streak +100" streak={3} />
        <AnswerResult correct={false} answer={{ label: "The Sun", index: 1 }} explanation="The Sun makes its own light; the Moon reflects it." />
      </section>

      <section id="projector" className="relative overflow-hidden bg-ink-900 p-10 text-white">
        <h2 className="font-display text-5xl font-extrabold">Which of these gives out its own light?</h2>
        <AnswerTiles className="mt-8" options={OPTIONS} big />
        <div className="mt-12"><AnswerBars options={OPTIONS} counts={{ a: 4, b: 19, c: 2, d: 1 }} correct={["b"]} /></div>
      </section>

      <section id="podium" className="relative overflow-hidden bg-ink-900 px-6 py-12 text-white">
        <GlyphField opacity={0.35} />
        <h2 className="relative mb-10 text-center font-display text-6xl font-extrabold">Leaderboard</h2>
        <div className="relative"><Podium entries={BOARD.slice(0, 3)} /></div>
        <div className="relative mx-auto mt-8 max-w-2xl"><Leaderboard entries={BOARD.slice(3)} size="lg" /></div>
      </section>

      <section id="lobby"><Lobby sessionId="preview" title="Equivalent fractions" teacher="Mrs. Nwosu" name="Ada" avatar="fox" participants={23} code="DV644Y" onAvatar={() => {}} /></section>
      <section id="end"><EndScreen name="Ada" avatar="fox" guest summary={{ answered: 8, correct: 7 }} score={{ score: 4860, rank: 1, of: 26 }} /></section>
    </div>
  );
}
