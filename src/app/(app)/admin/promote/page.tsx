import { requireRole, ADMINS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { PromoteSchool, type PromoteClass } from "./PromoteSchool";

export const metadata = { title: "End-of-year promotion" };

/** School admins: every class to its next class in one step. */
export default async function PromotePage() {
  const { sb } = await requireRole(ADMINS);
  const { data } = await sb.from("classes").select("id,name,class_members(count)").is("archived_at", null)
    .eq("class_members.role", "student").order("name");
  const classes: PromoteClass[] = (data ?? []).map((c) => ({
    id: c.id as string, name: c.name as string,
    students: ((c.class_members as { count: number }[] | null)?.[0]?.count) ?? 0
  }));
  return (
    <div className="page max-w-4xl">
      <PageHeader title="End-of-year promotion"
        subtitle="Choose where each class's students go next. Everyone moves from the class they are in now, so JSS 1 can go to JSS 2 while JSS 2 goes to JSS 3." />
      <PromoteSchool classes={classes} />
    </div>
  );
}
