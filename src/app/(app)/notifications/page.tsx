import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { notificationLabel } from "@/lib/types";
import { cn, formatDateTime, plural, safeNext, timeAgo } from "@/lib/utils";
import { MarkAllRead } from "./MarkAllRead";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { sb } = await requireRole();
  const { data } = await sb.from("notifications").select("id,kind,title,body,link,severity,read_at,created_at").order("created_at", { ascending: false }).limit(200);
  const rows = data ?? [];
  const unread = rows.filter((n) => !n.read_at).length;
  return (
    <div className="page max-w-3xl">
      <PageHeader title="Notifications" subtitle={rows.length === 0 ? undefined : unread ? `${plural(unread, "unread notification")}.` : "You're all caught up."}
        actions={unread ? <MarkAllRead /> : undefined} />
      {rows.length === 0 ? (
        <Empty icon={<Icon name="bell" />} title="Nothing yet">Class joins, grades, messages and alerts will show up here.</Empty>
      ) : (
        <ul className="card divide-y divide-ink-100 overflow-hidden">
          {rows.map((n) => {
            // Only links inside the app (the database writes them, but never trust a stored URL).
            const href = safeNext(n.link, "") || null;
            const row = cn("flex gap-3 px-5 py-4", !n.read_at && "bg-brand-50/40");
            const inner = (
              <>
                <span aria-hidden className={cn("mt-2 h-2 w-2 shrink-0 rounded-full",
                  n.severity === "critical" ? "bg-rose-600" : n.severity === "warning" ? "bg-amber-500" : !n.read_at ? "bg-brand-600" : "bg-transparent")} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className={cn("text-[15px] text-ink-900", n.read_at ? "font-medium" : "font-semibold")}>
                      {n.title}{!n.read_at && <span className="sr-only"> (unread)</span>}
                    </span>
                    <time dateTime={n.created_at} title={formatDateTime(n.created_at)} className="whitespace-nowrap text-xs text-ink-500">{timeAgo(n.created_at)}</time>
                  </span>
                  {n.body && <span className="mt-0.5 block text-sm text-ink-600">{n.body}</span>}
                  <span className="mt-2 block">
                    <Badge tone={n.severity === "critical" ? "red" : n.severity === "warning" ? "amber" : "gray"}>{notificationLabel(n.kind)}</Badge>
                  </span>
                </span>
              </>
            );
            return (
              <li key={n.id}>
                {href ? <Link href={href} className={cn(row, "no-underline transition-colors hover:bg-ink-50")}>{inner}</Link> : <div className={row}>{inner}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
