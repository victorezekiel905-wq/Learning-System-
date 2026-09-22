"use client";
import { useState } from "react";
import { Button, useToast } from "@/components/ui";
import { api, errorText } from "@/lib/rpc";

export function UpgradeButton({ plan, disabled }: { plan: string; disabled?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" loading={busy} disabled={disabled} onClick={async () => {
      setBusy(true);
      try { const r = await api<{ url: string }>("/api/billing/checkout", { method: "POST", json: { plan } }); window.location.href = r.url; }
      catch (e) { toast(errorText(e), "error"); setBusy(false); }
    }}>Choose plan</Button>
  );
}
