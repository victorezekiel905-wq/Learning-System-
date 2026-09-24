import { requireRole } from "@/lib/session";
import { SharedLesson } from "./SharedLesson";

export const metadata = { title: "Lesson" };

export default async function SharedLessonPage(props: { params: Promise<{ code: string }> }) {
  const params = await props.params;
  const { me } = await requireRole();
  return <SharedLesson code={params.code} tenantId={me.profile.tenant_id} userId={me.profile.id} />;
}
