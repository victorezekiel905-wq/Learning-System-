import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID = new Set(["present", "absent", "tardy", "excused"]);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const days = Math.min(31, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? "7")));
  const date = req.nextUrl.searchParams.get("date");
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  const startStr = start.toISOString().slice(0, 10);
  const endStr = date ?? end.toISOString().slice(0, 10);

  const { data: cls, error: classError } = await sb.from("classes")
    .select("id,name,join_code")
    .eq("id", params.id)
    .maybeSingle();
  if (classError) return NextResponse.json({ error: classError.message }, { status: 400 });
  if (!cls) return NextResponse.json({ error: "class not found" }, { status: 404 });

  const { data: members, error: memberError } = await sb.from("class_members")
    .select("role,users(id,full_name,email)")
    .eq("class_id", params.id)
    .order("joined_at", { ascending: true });
  if (memberError) return NextResponse.json({ error: memberError.message }, { status: 400 });

  const studentIds = (members ?? [])
    .filter((m: { role: string }) => m.role === "student")
    .map((m: { users: { id: string } | null }) => m.users?.id)
    .filter(Boolean) as string[];

  let attendanceQuery = sb.from("attendance")
    .select("id,class_id,student_id,date,status")
    .eq("class_id", params.id)
    .gte("date", startStr)
    .lte("date", endStr)
    .order("date", { ascending: false });
  if (studentIds.length > 0) attendanceQuery = attendanceQuery.in("student_id", studentIds);
  const { data: records, error: attendanceError } = await attendanceQuery;
  if (attendanceError) return NextResponse.json({ error: attendanceError.message }, { status: 400 });

  return NextResponse.json({
    class: cls,
    students: (members ?? [])
      .filter((m: { role: string }) => m.role === "student")
      .map((m: { users: { id: string; full_name: string; email: string } | null }) => ({
        id: m.users?.id,
        full_name: m.users?.full_name ?? "Student",
        email: m.users?.email ?? ""
      }))
      .filter((m: { id?: string }) => Boolean(m.id)),
    records: records ?? [],
    window: { start: startStr, end: endStr }
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const date = body.date as string | undefined;
  const records = Array.isArray(body.records) ? body.records : [];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "valid date required" }, { status: 400 });
  }
  if (records.length === 0) {
    return NextResponse.json({ error: "records[] required" }, { status: 400 });
  }

  const { data: me } = await sb.from("users").select("id,role,tenant_id").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up" }, { status: 400 });

  const { data: cls, error: classError } = await sb.from("classes")
    .select("id,tenant_id,teacher_id")
    .eq("id", params.id)
    .maybeSingle();
  if (classError) return NextResponse.json({ error: classError.message }, { status: 400 });
  if (!cls) return NextResponse.json({ error: "class not found" }, { status: 404 });

  const canManage = cls.teacher_id === user.id || ["school_admin", "it_admin", "platform_admin"].includes(me.role);
  if (!canManage) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const payload = records
    .filter((r: { student_id?: string; status?: string }) => r.student_id && VALID.has(String(r.status ?? "")))
    .map((r: { student_id: string; status: string }) => ({
      class_id: params.id,
      student_id: r.student_id,
      date,
      status: r.status
    }));
  if (payload.length === 0) return NextResponse.json({ error: "no valid records" }, { status: 400 });

  const { data, error } = await sb.from("attendance")
    .upsert(payload, { onConflict: "class_id,student_id,date" })
    .select("id,student_id,date,status");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, saved: data?.length ?? payload.length, records: data ?? [] });
}
