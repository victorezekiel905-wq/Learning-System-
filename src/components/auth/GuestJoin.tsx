"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { errorText, rpc } from "@/lib/rpc";

type GuestJoinResult = { session_id?: string; title?: string; error?: string; code?: string };

/**
 * Join a live lesson the Nearpod/Kahoot way: the code, then a name. No account.
 * Someone already signed in with a school account joins with that account instead.
 */
export function GuestJoin({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"code" | "name">(initialCode ? "name" : "code");
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const cleanCode = code.replace(/\s/g, "").toUpperCase();

  async function join() {
    setBusy(true); setErr(null);
    try {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      // A student signed in with their school account joins as themselves.
      if (session && !session.user.is_anonymous) {
        const r = await rpc<{ session_id: string }>("join_session", { p_code: cleanCode });
        router.push(`/student/live/${r.session_id}`);
        return;
      }
      if (!session) {
        const { error } = await sb.auth.signInAnonymously();
        if (error) throw new Error(/disabled|not enabled/i.test(error.message)
          ? "Joining as a guest isn't switched on for this site yet. Ask the school to turn on guest sign-ins."
          : error.message);
      }
      let r = await rpc<GuestJoinResult>("join_session_as_guest", { p_code: cleanCode, p_name: name });
      if (r.code === "GUEST_OTHER_SCHOOL") {
        // This browser was a guest at another school: start afresh.
        await sb.auth.signOut();
        const again = await sb.auth.signInAnonymously();
        if (again.error) throw new Error(again.error.message);
        r = await rpc<GuestJoinResult>("join_session_as_guest", { p_code: cleanCode, p_name: name });
      }
      if (r.error || !r.session_id) {
        setErr(r.error ?? "Couldn't join that lesson.");
        if (r.code === "P0002") setStep("code");
        setBusy(false);
        return;
      }
      router.push(`/guest/live/${r.session_id}`);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-3xl bg-ink-950 p-6 text-white shadow-overlay sm:p-8">
        {step === "code" ? (
          <form onSubmit={(e) => { e.preventDefault(); if (cleanCode.length >= 6) { setErr(null); setStep("name"); setTimeout(() => nameRef.current?.focus(), 0); } }}>
            <label htmlFor="join-code" className="block text-center font-display text-2xl font-extrabold tracking-tight">Enter the code</label>
            <p className="mt-1 text-center text-sm text-ink-300">It&apos;s on your teacher&apos;s screen.</p>
            <input id="join-code" autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" maxLength={8}
              value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" aria-describedby={err ? "join-err" : undefined}
              className="mt-5 block w-full rounded-2xl border-0 bg-white px-4 py-4 text-center font-mono text-4xl font-extrabold tracking-[0.3em] text-ink-950 placeholder:text-ink-300 focus:outline-none focus:ring-4 focus:ring-accent-400" />
            <Button type="submit" size="lg" className="btn-accent mt-4 w-full disabled:bg-white/10 disabled:text-ink-400 disabled:opacity-100" disabled={cleanCode.length < 6}>Next</Button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void join(); }}>
            <button type="button" onClick={() => { setStep("code"); setErr(null); }} className="text-sm text-ink-300 hover:text-white">
              ← Code <span className="font-mono font-bold tracking-widest text-white">{cleanCode}</span>
            </button>
            <label htmlFor="join-name" className="mt-3 block text-center font-display text-2xl font-extrabold tracking-tight">What&apos;s your name?</label>
            <p className="mt-1 text-center text-sm text-ink-300">Your teacher sees this name.</p>
            <input id="join-name" ref={nameRef} autoFocus={step === "name"} autoComplete="given-name" maxLength={40}
              value={name} onChange={(e) => setName(e.target.value)} placeholder="First name and initial" aria-describedby={err ? "join-err" : undefined}
              className="mt-5 block w-full rounded-2xl border-0 bg-white px-4 py-4 text-center text-2xl font-bold text-ink-950 placeholder:text-ink-300 focus:outline-none focus:ring-4 focus:ring-accent-400" />
            <Button type="submit" size="lg" className="btn-accent mt-4 w-full disabled:bg-white/10 disabled:text-ink-400 disabled:opacity-100" loading={busy} disabled={name.trim().length < 2}>Join the lesson</Button>
            <p className="mt-3 text-center text-xs text-ink-400">
              By joining you agree to the <Link href="/terms" className="text-ink-200 underline">Terms</Link> and <Link href="/privacy" className="text-ink-200 underline">Privacy Notice</Link>.
            </p>
          </form>
        )}
        {err && <p id="join-err" role="alert" className="mt-4 rounded-xl bg-rose-500/15 px-4 py-3 text-center text-sm font-medium text-rose-100">{err}</p>}
      </div>
    </div>
  );
}
