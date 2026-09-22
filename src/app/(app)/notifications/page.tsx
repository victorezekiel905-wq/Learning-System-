import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { sb } = await requireRole();
  const { data } = await sb.from("notifications").select("id,kind,title,body,link,severity,read_at,created_at").order("created_at", { ascending: false }).limit(200);
  const rows = data ?? [];
  return (
    <div className="page max-w-3xl">
      <PageHeader title="Notifications" />
      {rows.length === 0 ? <Empty title="Nothing yet" /> : (
        <ul className="card divide-y divide-ink-100">
          {rows.map((n) => (
            <li key={n.id} className={`px-5 py-3 ${n.read_at ? "" : "bg-brand-50/40"}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}</p>
                <Badge tone={n.severity === "critical" ? "red" : n.severity === "warning" ? "amber" : "gray"}>{n.kind.replace(/_/g, " ")}</Badge>
              </div>
              {n.body && <p className="text-sm text-ink-600">{n.body}</p>}
              <p className="text-xs text-ink-400">{formatDateTime(n.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
