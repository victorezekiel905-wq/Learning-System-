"use client";
import { useRouter } from "next/navigation";
import { ClipboardList, RotateCcw, Trash2 } from "lucide-react";
import { Button, Menu, useDialog, useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";

/**
 * A lesson card's actions: assign it as homework, or delete it. A lesson that has been
 * taught moves to Deleted (its results stay); one never taught is gone (migration 1110).
 */
export function LessonActions({ id, title, own }: { id: string; title: string; own: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  return (
    <Menu label={`More for ${title}`} items={[
      { label: "Assign as homework", icon: <ClipboardList className="h-4 w-4" aria-hidden />, onSelect: () => router.push(`/teacher/homework?lesson=${id}`) },
      ...(own ? [{ label: "Delete", tone: "danger" as const, icon: <Trash2 className="h-4 w-4" aria-hidden />, onSelect: async () => {
        if (!(await dialog.confirm({ title: `Delete "${title}"?`, body: "If you've taught it, it moves to Deleted and its results stay in reports; you can restore it from there. If not, it's gone for good.", tone: "danger", confirmLabel: "Delete" }))) return;
        try {
          const r = await rpc<{ deleted: boolean; archived: boolean }>("delete_lesson", { p_lesson: id });
          toast(r.archived ? "Moved to Deleted. Its results stay in reports." : "Lesson deleted.", "success");
          router.refresh();
        } catch (e) { toast(errorText(e), "error"); }
      } }] : [])
    ]} />
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
