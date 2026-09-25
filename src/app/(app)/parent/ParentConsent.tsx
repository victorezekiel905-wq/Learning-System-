"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, useToast, useDialog } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";
import { formatDate } from "@/lib/utils";

export type ConsentRow = { method: string; reference: string | null; recorded_at: string; revoked_at: string | null } | null;

/** A parent confirms (or withdraws) consent for their child's class device to be monitored during live lessons. */
export function ParentConsent({ studentId, name, consent }: { studentId: string; name: string; consent: ConsentRow }) {
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const active = !!consent && !consent.revoked_at;

  async function set(give: boolean) {
    let reason: string | null = null;
    if (!give) {
      reason = await dialog.ask({ title: `Withdraw consent for ${name}?`, body: "Your school will be told, and screen monitoring for your child stops.", label: "Reason (optional)", optional: true, multiline: true, tone: "danger", confirmLabel: "Withdraw consent" });
      if (reason === null) return;
    }
    setBusy(true);
    try {
      await rpc("parent_monitoring_consent", { p_student: studentId, p_consent: give, p_reason: reason });
      toast(give ? "Thank you. Your consent is recorded." : "Consent withdrawn. Your school has been notified in its records.", "success");
      router.refresh();
    } catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }

  return (
    <Card title="Classroom monitoring consent">
      <div className="space-y-3 text-sm">
        <p className="text-ink-700">
          During live lessons, {name}&apos;s teacher can see the screen of the device used for the lesson and is alerted if {name} leaves
          the lesson (for example to play a game). Nothing is monitored outside live lessons, and screen pictures are deleted when the lesson ends.
        </p>
        <p className="flex flex-wrap items-center gap-2">
          {active
            ? <><Badge tone="green">Consent on file</Badge><span className="text-ink-600">{consent!.method === "signed_undertaking" ? `Signed undertaking (${consent!.reference ?? "school records"})` : "Confirmed in this portal"}, {formatDate(consent!.recorded_at)}</span></>
            : <Badge tone="amber">No consent on file</Badge>}
        </p>
        <div className="flex flex-wrap gap-2">
          {!active && <Button loading={busy} onClick={() => set(true)}>I consent to monitoring during lessons</Button>}
          {active && <Button variant="secondary" loading={busy} onClick={() => set(false)}>Withdraw consent</Button>}
        </div>
      </div>
    </Card>
  );
}
