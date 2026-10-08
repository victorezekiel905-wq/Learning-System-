import { fail, requireProfile, withErrorLog } from "@/lib/api";
import { toCsv } from "@/lib/utils";

type V2 = {
  version: 2;
  students: { rank: number | null; name: string; guest: boolean; joined: boolean; score: number; answers: number; correct: number;
              accuracy: number | null; avg_seconds: number | null; best_streak: number }[];
  questions: { activity: string; prompt: string; kind: string; answered: number; correct: number; accuracy: number | null; avg_seconds: number | null;
               options: { label: string; is_correct: boolean; count: number }[]; missed_by: string[] }[];
};

/**
 * CSV export of a report the caller may read (RLS decides). For a live lesson:
 * the scores, or with ?part=questions one row per question.
 */
export const GET = withErrorLog(async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, response } = await requireProfile();
  if (response) return response;
  const { data: r } = await sb.from("reports").select("kind,title,payload,created_at,scope_id").eq("id", id).maybeSingle();
  if (!r) return fail(404, "Report not found.");
  const p = r.payload as Record<string, unknown>;

  let rows: Record<string, unknown>[];
  let v2 = p.version === 2 ? (p as unknown as V2) : null;
  if (!v2 && r.kind === "session_summary" && r.scope_id) {
    // Saved before the 0920 update: rebuild it from the lesson's answers.
    const { data } = await sb.rpc("session_report", { p_session: r.scope_id });
    if ((data as { version?: number } | null)?.version === 2) v2 = data as V2;
  }
  const questions = new URL(req.url).searchParams.get("part") === "questions";
  if (v2 && questions) {
    rows = v2.questions.map((q, i) => ({
      number: i + 1, activity: q.activity, question: q.prompt, type: q.kind, answered: q.answered, correct: q.correct,
      accuracy_percent: q.accuracy, average_seconds: q.avg_seconds,
      answers: q.options.map((o) => `${o.is_correct ? "✓ " : ""}${o.label}: ${o.count}`).join(" | "),
      got_it_wrong: q.missed_by.join(", ")
    }));
  } else if (v2) {
    rows = v2.students.map((s) => ({
      rank: s.rank ?? "", name: s.name, joined_with_code: s.guest ? "yes" : "", took_part: s.joined ? "yes" : "no", points: s.score,
      answered: s.answers, correct: s.correct, accuracy_percent: s.accuracy ?? "", average_seconds: s.avg_seconds ?? "", best_streak: s.best_streak
    }));
  } else if (r.kind === "session_summary") rows = (p.students as Record<string, unknown>[]) ?? [];
  else if (r.kind === "class_analytics") rows = (p.per_student as Record<string, unknown>[]) ?? [];
  else if (r.kind === "attendance") rows = ((p.rows as { date: string; status: string; source: string; users: { full_name: string } | null }[]) ?? [])
    .map((x) => ({ date: x.date, student: x.users?.full_name, status: x.status, source: x.source }));
  else rows = Object.entries(p).filter(([, v]) => typeof v !== "object").map(([k, v]) => ({ metric: k, value: v }));

  const csv = toCsv(rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !k.endsWith("_id") || k === "student_id"))));
  const name = (r.title.replace(/[^A-Za-z0-9 _-]+/g, "").replace(/\s+/g, "_").slice(0, 60) || "report") + (questions ? "_questions" : "");
  return new Response("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" }
  });
});
