import { callRpc, requireProfile, withErrorLog } from "@/lib/api";
import { toCsv } from "@/lib/utils";

type Gradebook = {
  assignments: { id: string; title: string; due_at: string | null; points: number }[];
  students: { id: string; name: string; email: string; scores: Record<string, { score: number | null; late: boolean; status: string }> }[];
};

/**
 * One CSV per class: a row per student, a column per assignment (score out of
 * its points, "late" marked), plus total and percentage. Opens in Excel, Google
 * Sheets or any school information system import.
 */
export const GET = withErrorLog(async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, response } = await requireProfile(["teacher", "school_admin", "platform_admin"]);
  if (response) return response;
  const r = await callRpc(sb, "class_gradebook", { p_class: id });
  if (r.response) return r.response;
  const gb = r.data as Gradebook;
  const { data: cls } = await sb.from("classes").select("name").eq("id", id).maybeSingle();

  const possible = gb.assignments.reduce((n, a) => n + Number(a.points), 0);
  const rows = gb.students.map((s) => {
    const row: Record<string, unknown> = { Student: s.name, Email: s.email };
    let total = 0;
    for (const a of gb.assignments) {
      const c = s.scores[a.id];
      const score = c?.score === null || c?.score === undefined ? null : Number(c.score);
      if (score !== null) total += score;
      row[`${a.title} (/${Number(a.points)})`] = c ? (score === null ? "Awaiting marking" : `${score}${c.late ? " (late)" : ""}`) : "";
    }
    row.Total = Math.round(total * 100) / 100;
    row["Out of"] = possible;
    row.Percent = possible > 0 ? `${Math.round((total / possible) * 1000) / 10}%` : "";
    return row;
  });

  const name = (cls?.name ?? "class").replace(/[^A-Za-z0-9 _-]+/g, "").replace(/\s+/g, "_").slice(0, 60) || "class";
  return new Response("﻿" + toCsv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}_gradebook.csv"`, "Cache-Control": "no-store" }
  });
});
