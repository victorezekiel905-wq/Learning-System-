import { requireRole, TEACHERS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { MediaLibrary } from "./MediaLibrary";

export const metadata = { title: "Media library" };

export default async function MediaPage() {
  const { me } = await requireRole(TEACHERS);
  return (
    <div className="page">
      <PageHeader title="Media library" subtitle="Images, video, audio and documents for your school's lessons. Images are compressed on upload." />
      <MediaLibrary me={{ id: me.profile.id, tenantId: me.profile.tenant_id }} />
    </div>
  );
}
