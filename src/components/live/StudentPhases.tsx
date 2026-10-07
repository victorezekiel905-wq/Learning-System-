"use client";
import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";
import { cn, formatJoinCode } from "@/lib/utils";
import { AVATARS, avatarFor } from "./avatars";

/** Before the teacher starts: who you are, your avatar, and how many have joined. */
export function Lobby({ sessionId, title, teacher, name, avatar, participants, code, onAvatar }: {
  sessionId: string; title: string; teacher: string; name: string; avatar: string | null;
  participants: number; code: string; onAvatar: () => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<string | null>(avatar);
  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center bg-ink-950 px-4 py-10 text-white">
      <p className="text-sm font-semibold text-accent-400">You&apos;re in</p>
      <h1 className="mt-2 text-balance text-center font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-1 text-ink-300">with {teacher}</p>

      <div className="mt-8 flex items-center gap-4 rounded-2xl bg-white/5 px-5 py-4">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/10 text-4xl" aria-hidden>{avatarFor(picked) ?? name.slice(0, 1).toUpperCase()}</span>
        <div>
          <p className="text-xl font-bold">{name}</p>
          <p className="text-sm text-ink-300">{participants} {participants === 1 ? "person has" : "people have"} joined</p>
        </div>
      </div>

      <fieldset className="mt-6 w-full max-w-sm">
        <legend className="mb-2 text-center text-sm text-ink-300">Pick your avatar</legend>
        <div className="grid grid-cols-6 gap-2">
          {Object.entries(AVATARS).map(([key, emoji]) => (
            <button key={key} type="button" aria-label={key} aria-pressed={picked === key}
              onClick={async () => {
                setPicked(key);
                try { await rpc("set_avatar", { p_session: sessionId, p_avatar: key }); onAvatar(); }
                catch (e) { toast(errorText(e), "error"); }
              }}
              className={cn("grid aspect-square place-items-center rounded-xl text-2xl transition", picked === key ? "bg-accent-500 ring-4 ring-accent-400/40" : "bg-white/10 hover:bg-white/20")}>
              <span aria-hidden>{emoji}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <p className="mt-10 flex items-center gap-2 text-ink-200">
        <span className="h-2 w-2 animate-pulse2 rounded-full bg-accent-400" aria-hidden />
        Waiting for your teacher to start…
      </p>
      <p className="mt-2 text-xs text-ink-400">Code <span className="font-mono font-bold tracking-widest text-ink-200">{formatJoinCode(code)}</span></p>
    </div>
  );
}

/** The teacher paused the lesson: everyone looks up. */
export function PausedOverlay({ teacher }: { teacher: string }) {
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="paused-title"
      className="fixed inset-0 z-50 grid place-items-center bg-ink-950/95 px-6 text-center text-white backdrop-blur-sm">
      <div>
        <p className="text-6xl" aria-hidden>👀</p>
        <h2 id="paused-title" className="mt-4 font-display text-4xl font-extrabold tracking-tight">Eyes on your teacher</h2>
        <p className="mt-2 text-lg text-ink-300">{teacher} has paused the lesson. It carries on in a moment.</p>
      </div>
    </div>
  );
}

/** After the lesson: thanks, and how you did. */
export function EndScreen({ name, avatar, summary, guest }: {
  name: string; avatar: string | null; summary: { answered: number; correct: number } | null; guest: boolean;
}) {
  const answered = summary?.answered ?? 0;
  const correct = summary?.correct ?? 0;
  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center bg-ink-950 px-4 py-10 text-center text-white">
      <span className="grid h-20 w-20 place-items-center rounded-3xl bg-white/10 text-5xl" aria-hidden>{avatarFor(avatar) ?? "🎉"}</span>
      <h1 className="mt-5 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Well done, {name}!</h1>
      <p className="mt-1 text-ink-300">The lesson has ended.</p>
      <dl className="mt-8 grid w-full max-w-sm grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/5 p-4"><dt className="text-sm text-ink-300">Answered</dt><dd className="font-display text-4xl font-extrabold">{answered}</dd></div>
        <div className="rounded-2xl bg-white/5 p-4"><dt className="text-sm text-ink-300">Correct</dt><dd className="font-display text-4xl font-extrabold text-accent-400">{correct}</dd></div>
      </dl>
      <Link href={guest ? "/join" : "/student"} className="btn btn-accent btn-lg mt-8 no-underline">{guest ? "Join another lesson" : "Back to home"}</Link>
    </div>
  );
}
