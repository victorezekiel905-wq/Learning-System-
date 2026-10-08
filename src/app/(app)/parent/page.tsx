import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Alert, Empty, PageHeader } from "@/components/ui";
import { ProgressDashboard } from "@/components/progress/ProgressDashboard";
import { ParentAlerts } from "@/components/parent/ParentAlerts";
import { firstName } from "@/lib/utils";
import { FEATURES } from "@/lib/features";
import { ParentConsent, type ConsentRow } from "./ParentConsent";

export const metadata = { title: "My children" };

export default async function ParentPage(props: { searchParams: Promise<{ child?: string }> }) {
  const searchParams = await props.searchParams;
  const { me, sb } = await requireRole(["parent"]);
  if (!FEATURES.parentPortal) {
    return <div className="page max-w-xl"><Alert title="Parent reports are coming soon">Your account is ready. Your child's lesson results will appear here once your school turns parent reports on.</Alert></div>;
  }
  if (!me.settings?.parent_portal_enabled) {
    return <div className="page max-w-xl"><Alert title="The parent portal is not switched on">Your school hasn't enabled parent reports yet. Please contact the school office.</Alert></div>;
  }
  const { data: kids } = await sb.rpc("parent_children");
  const children = (kids as { id: string; name: string }[]) ?? [];
  const child = children.find((c) => c.id === searchParams.child) ?? children[0];
  const monitoring = !!me.settings?.monitoring_enabled;
  const { data: consent } = child && monitoring
    ? await sb.from("monitoring_consents").select("method,reference,recorded_at,revoked_at").eq("student_id", child.id).maybeSingle()
    : { data: null };

  return (
    <div className="page">
      <PageHeader eyebrow={me.tenant?.name} title={child ? `${firstName(child.name)}'s report` : "My children"}
        subtitle="Lessons attended and how your child is doing in each subject and topic, by day, week, month, term or year." />
      {children.length === 0 ? <Empty title="No linked children">Ask your school for a parent invite code.</Empty> : (
        <>
          {children.length > 1 && (
            <nav className="mb-6 flex flex-wrap gap-2 print:hidden" aria-label="Choose a child">
              {children.map((c) => (
                <Link key={c.id} href={`/parent?child=${c.id}`} aria-current={c.id === child!.id ? "page" : undefined}
                  className={`btn no-underline ${c.id === child!.id ? "btn-ink" : "btn-secondary"}`}>{c.name}</Link>
              ))}
            </nav>
          )}
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <ProgressDashboard key={child!.id} studentId={child!.id} viewer="parent" />
            <aside className="space-y-6 print:hidden">
              <ParentAlerts studentId={child!.id} name={child!.name} />
              {monitoring && <>
                <ParentConsent studentId={child!.id} name={child!.name} consent={consent as ConsentRow} />
                <p className="text-[13px] leading-relaxed text-ink-500">
                  Monitoring only happens during live lessons, on the device your child uses for the lesson. SwiftCipher never monitors time
                  outside class, and screenshots are never shared with parents because they can show other children.
                </p>
              </>}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
