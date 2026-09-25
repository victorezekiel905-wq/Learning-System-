"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { ActionError, errorText, rpc } from "@/lib/rpc";

/**
 * One box for every code a student meets: live class (6), game (6),
 * class enrolment (6) or invite (10). We try them in that order.
 */
function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState((params.get("code") ?? "").toUpperCase());
  const [nickname, setNickname] = useState("");
  const [needNick, setNeedNick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function go() {
    setBusy(true); setErr(null); setOk(null);
    const c = code.trim().toUpperCase();
    const notFound = (e: unknown) => e instanceof ActionError && e.code === "P0002";
    try {
      if (c.length === 6) {
        try { const s = await rpc<{ session_id: string }>("join_session", { p_code: c }); router.push(`/student/live/${s.session_id}`); return; }
        catch (e) { if (!notFound(e)) throw e; }
        try { const g = await rpc<{ game_id: string }>("join_game", { p_code: c, p_nickname: nickname || null }); router.push(`/student/game/${g.game_id}`); return; }
        catch (e) {
          if (e instanceof ActionError && /nickname/i.test(e.message)) { setNeedNick(true); throw e; }
          if (!notFound(e)) throw e;
        }
      }
      const r = await rpc<{ class_name?: string; kind: string; error?: string; code?: string }>("redeem_code", { p_code: c });
      // A wrong code comes back as a value (so the server can count it), not an exception.
      if (r.error) throw new ActionError(r.error, r.code);
      setOk(r.kind === "class" ? `You've joined ${r.class_name}.` : "Code accepted.");
      setCode("");
      router.refresh();
    } catch (e) {
      setErr(errorText(e));
    }
    setBusy(false);
  }

  return (
    <Card>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <Field label="Code" hint="Live lesson, Challenge game or new class: your teacher will show you the code.">
          <Input autoFocus value={code} maxLength={12} className="text-center font-mono text-3xl font-bold uppercase tracking-[0.3em]"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
        </Field>
        {needNick && <Field label="Nickname for this game" hint="2-20 letters or numbers. Your teacher can see your real name."><Input value={nickname} onChange={(e) => setNickname(e.target.value)} /></Field>}
        {err && <Alert tone="error">{err}</Alert>}
        {ok && <Alert tone="success">{ok}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={code.length < 6}>Join</Button>
      </form>
    </Card>
  );
}

export default function JoinPage() {
  return (
    <div className="page max-w-lg">
      <PageHeader title="Join with a code" />
      <Suspense><JoinForm /></Suspense>
    </div>
  );
}
