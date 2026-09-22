"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { errorText, rpc } from "@/lib/rpc";
import { ROLE_LABEL, type Profile } from "@/lib/types";

export function AccountClient({ profile, resetMode }: { profile: Profile; resetMode: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(profile.full_name);
  const [nick, setNick] = useState(profile.nickname ?? "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  return (
    <div className="space-y-6">
      {resetMode && <Alert tone="info">Choose a new password below.</Alert>}
      <Card title="Profile">
        <div className="space-y-3">
          <p className="text-sm text-ink-500">{profile.email} · {ROLE_LABEL[profile.role]}</p>
          <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Preferred nickname" hint="Used in games when your teacher allows nicknames."><Input value={nick} maxLength={40} onChange={(e) => setNick(e.target.value)} /></Field>
          <Button onClick={async () => {
            const { error } = await createClient().from("users").update({ full_name: name.trim(), nickname: nick.trim() || null }).eq("id", profile.id);
            if (error) toast(error.message, "error"); else { toast("Saved", "success"); router.refresh(); }
          }}>Save profile</Button>
        </div>
      </Card>
      <Card title="Password">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New password"><Input type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Repeat"><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <Button className="mt-3" disabled={pw.length < 8 || pw !== pw2} onClick={async () => {
          const { error } = await createClient().auth.updateUser({ password: pw });
          if (error) toast(error.message, "error"); else { setPw(""); setPw2(""); toast("Password changed", "success"); }
        }}>Change password</Button>
      </Card>
      <Card title="Your data">
        <p className="mb-3 text-sm text-ink-600">Download a copy of everything your school holds about you in SwiftCipher. To have data deleted, ask your school administrator.</p>
        <Button variant="secondary" onClick={async () => {
          try {
            const data = await rpc("export_user_data", { p_user: profile.id });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
            a.download = "swiftcipher-my-data.json"; a.click();
          } catch (e) { toast(errorText(e), "error"); }
        }}>Download my data</Button>
      </Card>
    </div>
  );
}
