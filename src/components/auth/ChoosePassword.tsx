"use client";
import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { errorText, rpc } from "@/lib/rpc";

/**
 * First sign-in with a login made by the school (or after a reset): the student
 * chooses their own password before going on.
 */
export function ChoosePassword({ name }: { name: string }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setErr("Use at least 8 characters."); return; }
    if (pw !== again) { setErr("The two passwords are different."); return; }
    setBusy(true); setErr(null);
    try {
      const { error } = await createClient().auth.updateUser({ password: pw });
      if (error) throw new Error(error.message);
      await rpc("password_changed");
      window.location.reload();
    } catch (e2) { setErr(errorText(e2)); setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="choose-pw" className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-ink-50 px-5 py-10">
      <form onSubmit={save} className="w-full max-w-[400px]">
        <h1 id="choose-pw" className="font-display text-[28px] font-bold leading-tight tracking-[-0.02em]">Welcome, {name.split(" ")[0]}.</h1>
        <p className="mb-7 mt-2 text-[15px] leading-relaxed text-ink-600">Choose your own password. You&apos;ll use it with your username from now on. Keep it to yourself.</p>
        <div className="space-y-4">
          <Field label="New password" hint="At least 8 characters." htmlFor="pw1">
            <Input id="pw1" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </Field>
          <Field label="Type it again" htmlFor="pw2"><Input id="pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
          {err && <Alert tone="error">{err}</Alert>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>Save and continue</Button>
        </div>
      </form>
    </div>
  );
}
