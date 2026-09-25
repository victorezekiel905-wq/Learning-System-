import Link from "next/link";
import { requireRole, TEACHERS } from "@/lib/session";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { NewLessonButton } from "./NewLessonButton";

export const metadata = { title: "Lessons" };

type Lesson = { id: string; title: string; status: string; subject: string | null; is_template: boolean; owner_id: string; updated_at: string; current_version: number; users: { full_name: string } | null };

export default async function LessonsPage(
  props: { searchParams: Promise<{ tab?: string; q?: string; new?: string }> }
) {
  const searchParams = await props.searchParams;
  const { me, sb } = await requireRole(TEACHERS);
  const tab = searchParams.tab ?? "mine";
  let query = sb.from("lessons").select("id,title,status,subject,is_template,owner_id,updated_at,current_version,users(full_name)")
    .neq("status", "archived").order("updated_at", { ascending: false }).limit(200);
  if (tab === "mine") query = query.eq("owner_id", me.profile.id).eq("is_template", false);
  if (tab === "school") query = query.neq("owner_id", me.profile.id).eq("status", "published");
  if (tab === "templates") query = query.eq("is_template", true);
  if (searchParams.q) query = query.ilike("title", `%${searchParams.q.replace(/[%_]/g, "")}%`);
  const { data } = await query;
  const lessons = (data ?? []) as unknown as Lesson[];
  const { data: templates } = await sb.from("lessons").select("id,title").eq("is_template", true).limit(50);

  return (
    <div className="page">
      <PageHeader eyebrow="SwiftCipher Studio" title="Lessons" subtitle="Slides, media, interactive video and activities."
        actions={<NewLessonButton openInitially={searchParams.new === "1"} templates={templates ?? []} />} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 text-sm">
          {[["mine", "My lessons"], ["school", "Shared in school"], ["templates", "Templates"]].map(([id, label]) => (
            <Link key={id} href={`/teacher/lessons?tab=${id}`} className={`rounded-lg px-3 py-1.5 no-underline ${tab === id ? "bg-brand-600 text-white" : "text-ink-600 hover:bg-ink-100"}`}>{label}</Link>
          ))}
        </nav>
        <form className="flex gap-2"><input type="hidden" name="tab" value={tab} /><input name="q" defaultValue={searchParams.q} placeholder="Search lessons" className="input w-56" /></form>
      </div>
      {lessons.length === 0 ? (
        <Empty title={tab === "mine" ? "No lessons yet" : "Nothing here yet"}>
          {tab === "mine" ? "Create a lesson from scratch, start from a template, or import a PowerPoint, PDF or Word document." : "Published lessons from other teachers and templates appear here."}
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lessons.map((l) => (
            <Link key={l.id} href={`/teacher/lessons/${l.id}`} className="card card-pad block no-underline transition hover:border-ink-400">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-ink-900">{l.title}</h2>
                <Badge tone={l.is_template ? "cyan" : l.status === "published" ? "green" : "gray"}>{l.is_template ? "template" : l.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-ink-500">{l.subject ?? "—"}{l.current_version ? ` · v${l.current_version}` : ""}</p>
              <p className="mt-3 text-xs text-ink-500">{l.owner_id === me.profile.id ? "You" : l.users?.full_name} · updated {formatDate(l.updated_at)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
