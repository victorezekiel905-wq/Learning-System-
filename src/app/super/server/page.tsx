import { requireSuperAdmin } from "@/lib/session";
import { officeCheck } from "@/lib/lesson-import";
import { Alert, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Server check" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Check = {
  installed: boolean; bin?: string; version?: string | null; advice?: string;
  server: { cpus: number; memory_mb: number; free_mb: number };
  conversion?: { ok: boolean; seconds: number; reason: string; output?: string };
};

/** Can this server turn PowerPoint into picture slides? Converts a tiny file with LibreOffice and times it. */
export default async function SuperServer(props: { searchParams: Promise<{ run?: string }> }) {
  await requireSuperAdmin();
  const run = (await props.searchParams).run === "1";
  const c = run ? (await officeCheck()) as Check : null;
  const slow = c?.conversion?.ok && c.conversion.seconds > 20;
  return (
    <div className="space-y-4">
      <PageHeader title="Server check" subtitle="Checks that PowerPoint imports can keep their design on this server. Takes up to a minute."
        actions={<a href="/super/server?run=1" className="btn btn-primary btn-sm no-underline">{run ? "Run again" : "Run check"}</a>} />
      {c && (
        <Card>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-ink-500">LibreOffice</dt><dd>{c.installed ? (c.version || c.bin) : "Not installed"}</dd>
            <dt className="text-ink-500">Server</dt><dd>{c.server.cpus} CPU · {c.server.memory_mb} MB memory ({c.server.free_mb} MB free)</dd>
            {c.conversion && <><dt className="text-ink-500">Test conversion</dt>
              <dd>{c.conversion.ok ? `Worked in ${c.conversion.seconds} s` : `Failed after ${c.conversion.seconds} s: ${c.conversion.reason}`}</dd></>}
          </dl>
          {c.conversion?.output && <pre className="mt-3 max-h-60 overflow-auto rounded bg-ink-50 p-3 text-xs">{c.conversion.output}</pre>}
        </Card>
      )}
      {c && !c.installed && <Alert tone="error">{c.advice}</Alert>}
      {c?.conversion?.ok && !slow && <Alert tone="success">PowerPoint imports will keep their design.</Alert>}
      {slow && <Alert tone="warn">It works but slowly. A real deck takes several times longer than this test and may time out. Move the Render service to a bigger instance (Starter or Standard).</Alert>}
    </div>
  );
}
