import { requireRole, ADMINS } from "@/lib/session";
import { AdminNav } from "./AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(ADMINS);
  return (
    <div>
      <AdminNav />
      {children}
    </div>
  );
}
