"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { rpc, errorText } from "@/lib/rpc";
import { isNetworkMessage, NETWORK_MESSAGE } from "@/lib/errors";
import { safeNext } from "@/lib/utils";
import { Alert, Button, Field, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { WHO_LABEL, whoForRole, wrongTabMessage, type Who } from "@/lib/who";


/** Student · Parent · Staff, as links that keep the rest of the address (e.g. ?next=). */
export function RolePicker({ value, base }: { value: Who | null; base: "/login" | "/signup" }) {
  const params = useSearchParams();
  const href = (w: Who) => { const p = new URLSearchParams(params.toString()); p.set("as", w); return `${base}?${p.toString()}`; };
  return (
    <nav aria-label="I am a" className="mb-6 grid grid-cols-3 rounded-xl border border-ink-200 bg-white p-1">
      {(["student", "parent", "staff"] as Who[]).map((w) => (
        <Link key={w} href={href(w)} replace aria-current={value === w ? "page" : undefined}
          className={cn("rounded-lg px-3 py-2 text-center text-sm font-semibold no-underline transition",
            value === w ? "bg-ink-900 text-white hover:text-white" : "text-ink-700 hover:bg-ink-100 hover:text-ink-900")}>{WHO_LABEL[w]}</Link>
      ))}
    </nav>
  );
}

/** Supabase Auth messages are user-facing, except when the request never got there. */
const authMessage = (m: string) => (isNetworkMessage(m) ? NETWORK_MESSAGE : m);

const SSO = (process.env.NEXT_PUBLIC_SSO_PROVIDERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SSO_LABEL: Record<string, string> = { google: "Google", azure: "Microsoft", keycloak: "School SSO" };

function SsoButtons({ next, who }: { next: string; who: Who }) {
  if (!SSO.length) return null;
  return (
    <div className="space-y-2">
      {SSO.map((p) => (
        <Button key={p} variant="secondary" className="w-full" onClick={() =>
          createClient().auth.signInWithOAuth({
            provider: p as "google",
            options: { redirectTo: `${window.location.origin}/auth/callback?as=${who}&next=${encodeURIComponent(next)}` }
          })}>
          Continue with {SSO_LABEL[p] ?? p}
        </Button>
      ))}
      <div className="flex items-center gap-3 py-1 text-[12px] text-ink-500"><span className="h-px flex-1 bg-ink-200" />or<span className="h-px flex-1 bg-ink-200" /></div>
    </div>
  );
}

export function LoginForm({ who = "student" }: { who?: Who }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(
    params.get("error") === "suspended" ? "Your account is suspended. Contact your school administrator."
      : params.get("error") === "school_suspended" ? "Your school's SwiftCipher account is suspended. Please contact your school administrator."
      : params.get("error"));
  const [info, setInfo] = useState<string | null>(
    params.get("notice") === "confirmed" ? "Your email is confirmed. Sign in to finish setting up." : null
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const sb = createClient();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { setBusy(false); setErr(authMessage(error.message)); return; }
    // Each account signs in only from its own tab: student, parent or staff.
    const { data: me } = await sb.rpc("me");
    const m = me as { profile?: { role?: string } | null; super_admin?: boolean } | null;
    const actual = m?.profile ? whoForRole(m.profile.role) : m?.super_admin ? "staff" : null;
    if (actual && actual !== who) {
      await sb.auth.signOut({ scope: "local" });
      setBusy(false);
      setErr(wrongTabMessage(actual));
      return;
    }
    setBusy(false);
    router.replace(next);
    router.refresh();
  }

  async function reset() {
    if (!email) { setErr("Enter your email first."); return; }
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/account?reset=1")}`
    });
    if (error) setErr(authMessage(error.message)); else setInfo("Check your inbox for a password reset link.");
  }

  return (
    <div className="space-y-5">
      {who !== "parent" && <SsoButtons next={next} who={who} />}
      <form onSubmit={submit} className="space-y-5">
        <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {err && <Alert tone="error">{err}</Alert>}
        {info && <Alert tone="success">{info}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
      </form>
      <div className="space-y-3 border-t border-ink-200 pt-5 text-[13px]">
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className="font-semibold text-brand-700 hover:text-brand-800" onClick={reset}>Forgot password?</button>
          <Link href={`/signup?as=${who}`}>{who === "student" ? "New? Join with your class code" : who === "parent" ? "New parent? Sign up with your child's code" : "New staff? Use your invite code"}</Link>
        </div>
        {who === "staff" && <p className="text-ink-500">Setting up SwiftCipher for a new school? <Link href="/signup">Create a school</Link></p>}
        {who === "student" && <p className="text-ink-500">Joining a live lesson with a code? <Link href="/join">Join without an account</Link></p>}
      </div>
    </div>
  );
}

type Intent = { intent: "school"; school_name: string } | { intent: "code"; code: string; as?: Who };

const CODE_FIELD: Record<Who, { label: string; hint: string; button: string }> = {
  student: { label: "Class code", hint: "From your teacher (6 letters and numbers).", button: "Create account and join my class" },
  parent: { label: "Parent code", hint: "From your child's school (10 letters and numbers). One code per child: add your other children after you sign up.", button: "Create account and see my child" },
  staff: { label: "Staff invite code", hint: "From your school admin. Use the email address the invite was sent to.", button: "Create staff account" }
};

export function SignupForm({ mode, who }: { mode: "school" | "code"; who?: Who }) {
  const router = useRouter();
  const params = useSearchParams();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [school, setSchool] = useState("");
  const [code, setCode] = useState((params.get("code") ?? "").toUpperCase());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [agreed, setAgreed] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) { setErr("Please accept the Terms of Service and Privacy Notice to continue."); return; }
    setBusy(true); setErr(null);
    const intent: Intent = mode === "school" ? { intent: "school", school_name: school.trim() } : { intent: "code", code: code.trim().toUpperCase(), ...(who ? { as: who } : {}) };
    const sb = createClient();
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: {
        data: { full_name: fullName.trim(), ...intent, terms_accepted_at: new Date().toISOString() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`
      }
    });
    if (error) { setBusy(false); setErr(authMessage(error.message)); return; }
    // Supabase hides whether an email is registered: for an existing account it
    // returns a user with no identities and sends no email.
    if (data.user && (data.user.identities ?? []).length === 0) {
      setBusy(false);
      setErr("An account with this email already exists. Sign in instead (use Forgot password if needed).");
      return;
    }
    if (!data.session) { setBusy(false); setConfirm(true); return; }
    try {
      await completeIntent(intent, fullName.trim());
      router.replace("/dashboard");
      router.refresh();
    } catch (e2) {
      setErr(errorText(e2));
      setBusy(false);
    }
  }

  if (confirm) {
    return (
      <Alert tone="success" title="Check your email">
        We sent a confirmation link to <strong>{email}</strong>. Open it on this device to finish setting up your account.
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {mode === "code" ? (
        <Field label={who ? CODE_FIELD[who].label : "Join code"} hint={who ? CODE_FIELD[who].hint : "From your teacher (class code) or your school (invite code)."} htmlFor="code">
          <Input id="code" required value={code} maxLength={12} className="font-mono uppercase tracking-widest"
                 onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
        </Field>
      ) : (
        <Field label="School or organisation name" htmlFor="school">
          <Input id="school" required value={school} onChange={(e) => setSchool(e.target.value)} placeholder="e.g. Lagos Model College" />
        </Field>
      )}
      <Field label="Your full name" htmlFor="name"><Input id="name" required autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
      <Field label="Email" htmlFor="email"><Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Password" hint="At least 8 characters." htmlFor="password">
        <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <label className="flex items-start gap-3 rounded-xl border border-ink-200 bg-white p-3.5 text-[13px] leading-relaxed text-ink-700">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand-600" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          I agree to the <Link href="/terms" target="_blank">Terms of Service</Link> and have read the <Link href="/privacy" target="_blank">Privacy Notice</Link>
          {mode === "school"
            ? <>. For my school I also accept the <Link href="/dpa" target="_blank">Data Processing Agreement</Link>.</>
            : <>, and I will follow my school's acceptable-use policy.</>}
        </span>
      </label>
      {err && <Alert tone="error">{err}</Alert>}
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!agreed}>{mode === "school" ? "Create school workspace" : who ? CODE_FIELD[who].button : "Create account and join"}</Button>
    </form>
  );
}

export async function completeIntent(intent: Intent, fullName: string) {
  if (intent.intent === "school") {
    await rpc("bootstrap_school", { p_school_name: intent.school_name, p_full_name: fullName });
  } else {
    const r = await rpc<{ error?: string }>("redeem_code", { p_code: intent.code, p_full_name: fullName, p_as: intent.as ?? null });
    // A wrong code comes back as a value (so the server can count it), not an exception.
    if (r?.error) throw new Error(r.error);
  }
  // The profile exists now: record the acceptance given on the signup form.
  await Promise.all([
    rpc("accept_notice", { p_kind: "terms_of_service" }),
    rpc("accept_notice", { p_kind: "privacy_notice" })
  ]).catch(() => { /* consent is re-asked on the account page if this fails */ });
}
