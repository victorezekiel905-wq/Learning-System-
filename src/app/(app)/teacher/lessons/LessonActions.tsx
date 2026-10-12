"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipboardList, RotateCcw, Trash2 } from "lucide-react";
import { Button, useDialog, useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";

/**
 * Delete a lesson, after asking. A lesson that has been taught moves to Deleted (its
 * results stay); one never taught is gone (migration 1110).
 */
export function DeleteLessonButton({ id, title, onDeleted, size = "sm", className }: {
  id: string; title: string; onDeleted?: () => void; size?: "sm" | "md"; className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  return (
    <Button size={size} variant="ghost" loading={busy} className={`text-rose-700 hover:bg-rose-50 hover:text-rose-800 ${className ?? ""}`} aria-label={`Delete ${title}`}
      onClick={async () => {
        if (!(await dialog.confirm({ title: `Delete "${title}"?`, body: "If you've taught it, it moves to Deleted and its results stay in reports; you can restore it from there. If not, it's gone for good.", tone: "danger", confirmLabel: "Delete" }))) return;
        setBusy(true);
        try {
          const r = await rpc<{ deleted: boolean; archived: boolean }>("delete_lesson", { p_lesson: id });
          toast(r.archived ? "Moved to Deleted. Its results stay in reports." : "Lesson deleted.", "success");
          if (onDeleted) onDeleted(); else router.refresh();
        } catch (e) {
          const msg = errorText(e);
          // The database update with delete_lesson (1110) hasn't been run yet.
          toast(/delete_lesson|function|schema cache/i.test(msg) ? "Deleting needs the latest database update. Ask whoever runs your Supabase to run the update file." : msg, "error");
        } finally { setBusy(false); }
      }}>
      <Trash2 className="h-4 w-4" aria-hidden /> Delete
    </Button>
  );
}

/** A lesson card's buttons: assign it as homework, and delete it (owner or school admin). */
export function LessonCardActions({ id, title, canDelete }: { id: string; title: string; canDelete: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-ink-100 px-3 py-2 sm:px-4">
      <Link href={`/teacher/homework?lesson=${id}`} className="btn btn-ghost btn-sm no-underline" aria-label={`Assign ${title} as homework`}>
        <ClipboardList className="h-4 w-4" aria-hidden /> Assign
      </Link>
      {canDelete && <DeleteLessonButton id={id} title={title} />}
    </div>
  );
}

/** Deleted tab: bring a lesson back as a draft. */
export function RestoreLesson({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  return (
    <Button size="sm" variant="secondary" onClick={async () => {
      try { await rpc("restore_lesson", { p_lesson: id }); toast("Restored to My lessons.", "success"); router.refresh(); }
      catch (e) { toast(errorText(e), "error"); }
    }}><RotateCcw className="h-4 w-4" aria-hidden />Restore</Button>
  );
}
