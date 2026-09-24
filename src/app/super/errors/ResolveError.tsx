"use client";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";

export function ResolveError({ id }: { id: number }) {
  const router = useRouter();
  const toast = useToast();
  return (
    <Button size="sm" variant="secondary" onClick={async () => {
      try { await rpc("sa_resolve_error", { p_id: id }); router.refresh(); }
      catch (e) { toast(errorText(e), "error"); }
    }}>Mark resolved</Button>
  );
}
