"use client";
import { DownloadMenu } from "@/components/progress/DownloadMenu";
import { downloadCsv, pct } from "@/lib/download";

type Analytics = {
  students: number; sessions: number; participation_rate: number | null; question_accuracy: number | null; avg_response_ms: number | null;
  hardest_questions: { question_id: string; prompt: string; responses: number; accuracy: number }[];
  environment_leave_rate: number | null; off_task_rate: number | null;
  per_student: { student_id: string; name: string; sessions_joined: number; accuracy: number | null; submissions: number; alerts: number }[];
};

/** Download the class analytics: summary, each student, and the hardest questions. */
export function InsightsDownload({ a, className, days }: { a: Analytics; className: string; days: number }) {
  return (
    <DownloadMenu onCsv={() => downloadCsv(`Analytics - ${className} - last ${days} days`, [
      { title: "Summary", rows: [{ Class: className, "Period (days)": days, Lessons: a.sessions, Students: a.students, Participation: pct(a.participation_rate),
        "Question accuracy": pct(a.question_accuracy), "Average answer time (s)": a.avg_response_ms ? Math.round(a.avg_response_ms / 1000) : "",
        "Leave events per lesson": a.environment_leave_rate ?? "", "Off-task alerts per lesson": a.off_task_rate ?? "" }] },
      { title: "Students", rows: a.per_student.map((s) => ({ Student: s.name, "Lessons joined": s.sessions_joined, Accuracy: pct(s.accuracy), Submissions: s.submissions, "Focus alerts": s.alerts })) },
      { title: "Hardest questions", rows: a.hardest_questions.map((q) => ({ Question: q.prompt, Responses: q.responses, Accuracy: pct(q.accuracy) })) }
    ])} />
  );
}
