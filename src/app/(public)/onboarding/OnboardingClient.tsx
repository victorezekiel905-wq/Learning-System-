"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { completeIntent } from "@/components/auth/AuthForms";
import { Alert, Button, Field, Input, Tabs } from "@/components/ui";
import { errorText } from "@/lib/rpc";

export function OnboardingClient({ defaults }: { defaults: { full_name?: string; intent?: string; school_name?: string; code?: string } }) {
  const router = useRouter();
  const [tab, setTab] = useState<"code" | "school">(defaults.intent === "school" ? "school" : "code");
  const [name, setName] = useState(defaults.full_name ?? "");
  const [school, setSchool] = useState(defaults.school_name ?? "");
  const [code, setCode] = useState(defaults.code ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const auto = useRef(false);

  async function run(kind: "school" | "code") {
    setBusy(true); setErr(null);
    try {
      await completeIntent(kind === "school" ? { intent: "school", school_name: school.trim() } : { intent: "code", code: code.trim() }, name.trim());
      router.replace("/dashboard");
      router.refresh();
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  // Resume the choice made at sign-up once the email is confirmed.
  useEffect(() => {
    if (auto.current || !defaults.full_name) return;
    if ((defaults.intent === "school" && defaults.school_name) || (defaults.intent === "code" && defaults.code)) {
      auto.current = true;
      void run(defaults.intent === "school" ? "school" : "code");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card card-pad space-y-5">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "code", label: "I have a code" }, { id: "school", label: "Create a school" }]} />
      <Field label="Your full name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      {tab === "code" ? (
        <Field label="Class or invite code">
          <Input value={code} className="font-mono uppercase tracking-widest" maxLength={12}
                 onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
        </Field>
      ) : (
        <Field label="School name"><Input value={school} onChange={(e) => setSchool(e.target.value)} /></Field>
      )}
      {err && <Alert tone="error">{err}</Alert>}
      <Button className="w-full" loading={busy} disabled={!name.trim() || (tab === "code" ? code.length < 6 : !school.trim())} onClick={() => run(tab)}>
        Continue
      </Button>
    </div>
  );
}
