"use client";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export function GuestBar({ name, school }: { name: string; school: string | null }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <LogoMark className="h-7 w-7" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-ink-900">{name} <span className="font-normal text-ink-500">· guest</span></p>
          {school && <p className="truncate text-xs text-ink-500">{school}</p>}
        </div>
        <Button size="sm" variant="secondary" onClick={async () => {
          await createClient().auth.signOut();
          router.push("/join");
        }}>Leave</Button>
      </div>
    </header>
  );
}
