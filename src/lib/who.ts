/** Who is signing in or up. Staff = teachers, IT and school admins. (Shared by server pages and client forms.) */
export type Who = "student" | "parent" | "staff";
export const WHO_LABEL: Record<Who, string> = { student: "Student", parent: "Parent", staff: "Staff" };
export const parseWho = (v: string | null | undefined): Who | null => (v === "student" || v === "parent" || v === "staff" ? v : null);
