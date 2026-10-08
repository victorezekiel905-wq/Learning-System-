import { requireRole, TEACHERS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { FeedbackInbox } from "./FeedbackInbox";

export const metadata = { title: "Parent feedback" };

export default async function FeedbackPage() {
  const { me } = await requireRole(TEACHERS);
  const admin = ["school_admin", "platform_admin"].includes(me.profile.role);
  return (
    <div className="page max-w-4xl">
      <PageHeader title="Parent feedback"
        subtitle={admin ? "Feedback from parents to every subject teacher in the school. Teachers reply to their own." : "What parents have written to you about their children in your subjects. Reply once to each."} />
      <FeedbackInbox admin={admin} />
    </div>
  );
}
