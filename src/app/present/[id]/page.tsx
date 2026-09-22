import { requireRole, TEACHERS } from "@/lib/session";
import { Presenter } from "./Presenter";

export const metadata = { title: "Present" };

/** Front-of-class / projector view (§3.1, §3.7). Teacher-only; no app chrome. */
export default async function PresentPage({ params }: { params: { id: string } }) {
  await requireRole(TEACHERS);
  return <Presenter sessionId={params.id} />;
}
