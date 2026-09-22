import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type AttendanceRow = {
  id: string;
  date: string;
  status: string;
  student_id: string;
  users?: { full_name?: string; email?: string } | null;
};

// §18 + §20 — Aggregate a report (participation / env_alerts / devices / attendance)
// for a class, then persist a tenant-scoped row in `reports`.
export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.class_id || !body.kind)
    return NextResponse.json({ error: "class_id, kind required" }, { status: 400 });
  const format = (body.format ?? "csv") as string;
  if (!["csv", "pdf", "json"].includes(format))
    return NextResponse.json({ error: "invalid format" }, { status: 400 });

  const { data: cls, error: classError } = await sb.from("classes")
    .select("id,name,tenant_id")
    .eq("id", body.class_id)
    .maybeSingle();
  if (classError) return NextResponse.json({ error: classError.message }, { status: 400 });
  if (!cls) return NextResponse.json({ error: "class not found" }, { status: 404 });

  let payload: Record<string, unknown> | null = null;
  if (body.kind === "attendance") {
    const { data: attendance, error: attendanceError } = await sb.from("attendance")
      .select("id,date,status,student_id,users!attendance_student_id_fkey(full_name,email)")
      .eq("class_id", body.class_id)
      .order("date", { ascending: false })
      .limit(200);
    if (attendanceError) return NextResponse.json({ error: attendanceError.message }, { status: 400 });

    const rows = (attendance ?? []) as AttendanceRow[];
    const summary = rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    payload = {
      class_name: cls.name,
      total_records: rows.length,
      present: summary.present ?? 0,
      tardy: summary.tardy ?? 0,
      excused: summary.excused ?? 0,
      absent: summary.absent ?? 0,
      last: rows.slice(0, 25).map((row) => ({
        id: row.id,
        date: row.date,
        status: row.status,
        student_id: row.student_id,
        student_name: row.users?.full_name ?? row.users?.email ?? row.student_id
      }))
    };
  } else {
    const rpc = await sb.rpc("report_aggregate", {
      p_class: body.class_id, p_kind: body.kind
    });
    if (rpc.error) return NextResponse.json({ error: rpc.error.message }, { status: 400 });
    if ((rpc.data as { error?: string })?.error)
      return NextResponse.json({ error: (rpc.data as { error: string }).error }, { status: 400 });
    payload = rpc.data as Record<string, unknown>;
  }

  const reportName = `${body.kind}_${(cls.name ?? "class").toString().replace(/\s+/g, "-").toLowerCase()}_${Date.now()}`;
  const { data, error: insErr } = await sb.from("reports").insert({
    tenant_id: cls.tenant_id,
    name: reportName,
    kind: body.kind,
    format,
    status: "ready",
    payload
  }).select("id,name,kind,format,status,created_at,payload").single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: profile } = await sb.from("users").select("id,role").eq("id", user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "profile not set up" }, { status: 400 });
  const { data } = await sb.from("reports")
    .select("id,name,kind,format,status,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  return NextResponse.json(data ?? []);
}
