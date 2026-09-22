"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SsoButtons() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: "google" | "azure") {
    setBusy(provider); setError(null);
    const sb = createClient();
    const { error: authError } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` }
    });
    if (authError) { setError(authError.message); setBusy(null); }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-ghost border border-slate-200" disabled={!!busy} onClick={() => signIn("google")}>
          {busy === "google" ? "Opening…" : "Continue with Google"}
        </button>
        <button type="button" className="btn btn-ghost border border-slate-200" disabled={!!busy} onClick={() => signIn("azure")}>
          {busy === "azure" ? "Opening…" : "Continue with Microsoft"}
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <p className="text-center text-[11px] text-slate-400">SSO providers must be enabled in the Supabase Auth dashboard.</p>
    </div>
  );
}
