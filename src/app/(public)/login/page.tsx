import { Suspense } from "react";
import { LoginForm, RolePicker } from "@/components/auth/AuthForms";
import { parseWho, type Who } from "@/lib/who";
import { AuthShell } from "@/components/auth/AuthShell";
import { AUTH_ART } from "@/components/auth/AuthArt";

const INTRO: Record<Who, string> = {
  student: "Sign in to join your lessons and see how you're doing.",
  parent: "See how your child is doing in every subject.",
  staff: "For teachers and school staff."
};


export const metadata = { title: "Sign in" };

/** The tab for a page someone was sent from (e.g. a teacher's link): /teacher -> Staff. */
function whoForPath(next: string | undefined): Who | null {
  if (!next) return null;
  if (/^\/(teacher|admin|super|guard|present)(\/|$)/.test(next)) return "staff";
  if (/^\/parent(\/|$)/.test(next)) return "parent";
  if (/^\/student(\/|$)/.test(next)) return "student";
  return null;
}

export default async function LoginPage(props: { searchParams: Promise<{ as?: string; next?: string }> }) {
  const sp = await props.searchParams;
  const who = parseWho(sp.as) ?? whoForPath(sp.next) ?? "student";
  return (
    <AuthShell title="Welcome back." intro={INTRO[who]} art={AUTH_ART[who]}>
      <Suspense>
        <RolePicker value={who} base="/login" />
        <LoginForm who={who} />
      </Suspense>
    </AuthShell>
  );
}
