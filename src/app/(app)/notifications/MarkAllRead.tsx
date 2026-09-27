"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export function MarkAllRead() {
  const router = useRouter();
  return (
    <Button variant="secondary" size="sm" onClick={async () => {
      const { error } = await createClient().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
      if (error) throw new Error(error.message);
      router.refresh();
    }}>Mark all read</Button>
  );
}
