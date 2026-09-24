"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";

/** Shown to anyone who hasn't recorded acceptance of the current Terms (e.g. accounts created before they existed). */
export function TermsBanner() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="border-b border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-900" role="region" aria-label="Terms update">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <span>Please review and accept the <Link href="/terms" target="_blank">Terms of Service</Link> and <Link href="/privacy" target="_blank">Privacy Notice</Link> to keep using SwiftCipher.</span>
        <Button size="sm" loading={busy} onClick={async () => {
          setBusy(true);
          try {
            await rpc("accept_notice", { p_kind: "terms_of_service" });
            await rpc("accept_notice", { p_kind: "privacy_notice" });
            router.refresh();
          } catch (e) { toast(errorText(e), "error"); setBusy(false); }
        }}>I accept</Button>
      </div>
    </div>
  );
}
