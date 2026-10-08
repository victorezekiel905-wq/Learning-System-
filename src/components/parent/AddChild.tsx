"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";

/** A parent adds another child with that child's parent code; all children share one dashboard. */
export function AddChild({ first }: { first?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setOk(false);
    try {
      const r = await rpc<{ error?: string }>("redeem_code", { p_code: code, p_as: "parent" });
      if (r?.error) throw new Error(r.error);
      setCode(""); setOk(true);
      router.refresh();
    } catch (e2) { setErr(errorText(e2)); }
    setBusy(false);
  }

  return (
    <Card title={first ? "Add your child" : "Add another child"}>
      <form onSubmit={add} className="space-y-3">
        <Field label="Parent code" hint="From your child's school. Each child has their own code." htmlFor="child-code">
          <Input id="child-code" value={code} maxLength={12} required className="font-mono uppercase tracking-widest"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
        </Field>
        {err && <Alert tone="error">{err}</Alert>}
        {ok && <Alert tone="success">Child added. Choose their name above to see their report.</Alert>}
        <Button type="submit" loading={busy} disabled={code.length < 8}>Add child</Button>
      </form>
    </Card>
  );
}
