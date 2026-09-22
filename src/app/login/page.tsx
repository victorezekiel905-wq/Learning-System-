"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import SsoButtons from "@/components/auth/SsoButtons";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const sb = createClient();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { setBusy(false); setErr(error.message); return; }

    // Ensure the multi-tenant profile exists (idempotent; student role re-joins by class).
    const r = await fetch("/api/auth/setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "teacher" })
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok && !j.already) { setErr(j.error ?? "profile setup failed"); return; }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-slate-600">Sign in to your school workspace.</p>
      <div className="card mt-8 space-y-4 p-6">
        <SsoButtons />
        <div className="flex items-center gap-3 text-[11px] text-slate-400"><span className="h-px flex-1 bg-slate-200" />or use email<span className="h-px flex-1 bg-slate-200" /></div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="text-center text-xs text-slate-500">
          New here? <Link href="/signup" className="font-medium text-brand-600">Create a school account</Link> ·{" "}
          <Link href="/student/join" className="font-medium text-brand-600">Join as student</Link>
        </p>
      </form>
      </div>
    </main>
  );
}
