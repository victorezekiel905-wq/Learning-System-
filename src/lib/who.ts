/** Who is signing in or up. Staff = teachers, IT and school admins. (Shared by server pages and client forms.) */
export type Who = "student" | "parent" | "staff";
export const WHO_LABEL: Record<Who, string> = { student: "Student", parent: "Parent", staff: "Staff" };
export const parseWho = (v: string | null | undefined): Who | null => (v === "student" || v === "parent" || v === "staff" ? v : null);

/** Which sign-in tab an account belongs to (null: no school profile yet). */
export function whoForRole(role: string | null | undefined): Who | null {
  if (role === "student") return "student";
  if (role === "parent") return "parent";
  if (role === "teacher" || role === "school_admin" || role === "it_admin" || role === "platform_admin") return "staff";
  return null;
}

/** Shown when someone signs in on the wrong tab. */
export function wrongTabMessage(actual: Who): string {
  const name = WHO_LABEL[actual];
  return `This is a ${name.toLowerCase()} account. Choose "${name}" above and sign in there.`;
}
