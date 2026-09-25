import Link from "next/link";
import { requireRole, STAFF } from "@/lib/session";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { CreateClassButton } from "./CreateClassButton";

export const metadata = { title: "Classes" };

export default async function ClassesPage() {
  const { me, sb } = await requireRole(STAFF);
  const canCreate = me.profile.role !== "it_admin";
  const { data } = await sb.from("classes")
    .select("id,name,subject,grade_level,join_code,archived_at,teacher_id,class_members(count)")
    .order("archived_at", { nullsFirst: true }).order("name");
  const classes = (data ?? []) as unknown as {
    id: string; name: string; subject: string | null; grade_level: string | null; join_code: string;
    archived_at: string | null; teacher_id: string; class_members: { count: number }[];
  }[];

  return (
    <div className="page">
      <PageHeader title="Classes" subtitle="Rosters, join codes, groups and attendance." actions={canCreate && <CreateClassButton />} />
      {classes.length === 0 ? (
        <Empty title="No classes yet" action={canCreate && <CreateClassButton />}>Classes hold your roster. Students join with the class code.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => (
            <Link key={c.id} href={`/teacher/classes/${c.id}`} className="card card-pad block no-underline transition hover:border-ink-400">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-ink-900">{c.name}</h2>
                {c.archived_at ? <Badge>Archived</Badge> : <span className="font-mono text-sm font-bold text-brand-700">{c.join_code}</span>}
              </div>
              <p className="mt-1 text-sm text-ink-500">{[c.subject, c.grade_level].filter(Boolean).join(" · ") || "No subject set"}</p>
              <p className="mt-3 text-xs text-ink-500">{Math.max((c.class_members[0]?.count ?? 1) - 1, 0)} students{c.teacher_id === me.profile.id ? "" : " · co-taught"}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
