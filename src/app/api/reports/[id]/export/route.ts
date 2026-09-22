import { fail, requireProfile } from "@/lib/api";
import { toCsv } from "@/lib/utils";

/** CSV export of a report the caller may read (RLS decides). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { sb, response } = await requireProfile();
  if (response) return response;
  const { data: r } = await sb.from("reports").select("kind,title,payload,created_at").eq("id", params.id).maybeSingle();
  if (!r) return fail(404, "Report not found.");
  const p = r.payload as Record<string, unknown>;

  let rows: Record<string, unknown>[];
  if (r.kind === "session_summary") rows = (p.students as Record<string, unknown>[]) ?? [];
  else if (r.kind === "class_analytics") rows = (p.per_student as Record<string, unknown>[]) ?? [];
  else if (r.kind === "attendance") rows = ((p.rows as { date: string; status: string; source: string; users: { full_name: string } | null }[]) ?? [])
    .map((x) => ({ date: x.date, student: x.users?.full_name, status: x.status, source: x.source }));
  else rows = Object.entries(p).filter(([, v]) => typeof v !== "object").map(([k, v]) => ({ metric: k, value: v }));

  const csv = toCsv(rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !k.endsWith("_id") || k === "student_id"))));
  const name = r.title.replace(/[^A-Za-z0-9 _-]+/g, "").replace(/\s+/g, "_").slice(0, 60) || "report";
  return new Response("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" }
  });
}
