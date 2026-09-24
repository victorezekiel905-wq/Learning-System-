import { requireSuperAdmin } from "@/lib/session";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { ResolveError } from "./ResolveError";

export const metadata = { title: "Errors" };

type Row = {
  id: number; source: string; message: string; stack: string | null; url: string | null; user_agent: string | null;
  release: string | null; tenant: string | null; count: number; first_seen_at: string; last_seen_at: string; resolved_at: string | null;
};

export default async function SuperErrors(props: { searchParams: Promise<{ all?: string }> }) {
  const searchParams = await props.searchParams;
  const { sb } = await requireSuperAdmin();
  const all = searchParams.all === "1";
  const { data } = await sb.rpc("sa_errors", { p_include_resolved: all, p_limit: 500 });
  const rows = (data as Row[]) ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title="Errors" subtitle="Crashes and failed requests reported by browsers and the server, grouped by cause. Kept for 30 days."
        actions={<a href={all ? "/super/errors" : "/super/errors?all=1"} className="btn btn-secondary btn-sm no-underline">{all ? "Open only" : "Include resolved"}</a>} />
      <Card pad={false}>
        {rows.length === 0 ? <p className="p-5 text-sm text-ink-500">No open errors. 🎉</p> : (
          <ul className="divide-y divide-ink-100">
            {rows.map((r) => (
              <li key={r.id} className="space-y-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.source === "client" ? "amber" : "red"}>{r.source}</Badge>
                  <Badge tone="gray">×{r.count}</Badge>
                  {r.resolved_at && <Badge tone="green">resolved</Badge>}
                  <span className="min-w-0 flex-1 truncate font-mono text-sm">{r.message}</span>
                  {!r.resolved_at && <ResolveError id={r.id} />}
                </div>
                <p className="text-xs text-ink-500">
                  Last {formatDateTime(r.last_seen_at)} · first {formatDateTime(r.first_seen_at)}
                  {r.tenant && ` · ${r.tenant}`}{r.url && ` · ${r.url}`}{r.release && ` · release ${r.release.slice(0, 7)}`}
                </p>
                {(r.stack || r.user_agent) && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-ink-500">Details</summary>
                    {r.stack && <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-ink-900 p-2 text-[11px] text-ink-100">{r.stack}</pre>}
                    {r.user_agent && <p className="mt-1 text-ink-500">{r.user_agent}</p>}
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
