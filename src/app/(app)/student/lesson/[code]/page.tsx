import { requireRole } from "@/lib/session";
import { SharedLesson } from "./SharedLesson";

export const metadata = { title: "Lesson" };

export default async function SharedLessonPage({ params }: { params: { code: string } }) {
  const { me } = await requireRole();
  return <SharedLesson code={params.code} tenantId={me.profile.tenant_id} userId={me.profile.id} />;
}
