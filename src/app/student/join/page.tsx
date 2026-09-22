"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function StudentJoin() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"signup" | "login">("signup");

  useEffect(() => {
    createClient().auth.getUser().then(({ data }: { data: { user: unknown } | null }) => {
      if (data?.user) setMode("login");
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const sb = createClient();
    if (mode === "signup") {
      const { data, error } = await sb.auth.signUp({
        email, password, options: { data: { full_name: fullName } }
      });
      if (error) { setBusy(false); setErr(error.message); return; }
      if (!data.user) { setBusy(false); setErr("Confirm your email first, then sign in."); return; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { setBusy(false); setErr(error.message); return; }
    }

    // Bootstrap the student profile into the class's tenant, then find the session.
    const setup = await fetch("/api/auth/setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "student", full_name: fullName, join_code: code.trim().toUpperCase() })
    });
    const setupJson = await setup.json().catch(() => ({}));
    if (!setup.ok && !setupJson.already) { setBusy(false); setErr(setupJson.error ?? "class not found"); return; }

    const r = await fetch("/api/class-sessions/lookup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ join_code: code.trim().toUpperCase() })
    });
    setBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "No live session found for that code."); return; }
    const j = await r.json();
    if (!j.id) { setErr("No live session found for that code."); return; }
    router.push(`/student/live/${j.id}`);
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Join a class</h1>
      <p className="mt-1 text-sm text-slate-600">Enter the 6-character code your teacher showed.</p>
      <form onSubmit={onSubmit} className="card mt-8 space-y-4 p-6">
        <div>
          <label className="label">Join code</label>
          <input className="input uppercase" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        {mode === "signup" && (
          <div>
            <label className="label">Your name</label>
            <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
        )}
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Joining…" : mode === "signup" ? "Sign up + join" : "Sign in + join"}</button>
        <button type="button" onClick={() => setMode(mode === "signup" ? "login" : "signup")} className="btn btn-ghost w-full text-xs">
          {mode === "signup" ? "Already have an account? Sign in instead" : "First time here? Create a student account"}
        </button>
      </form>
    </main>
  );
}
