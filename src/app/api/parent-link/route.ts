import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type LinkRow = {
  id: string;
  parent_user_id: string;
  student_user_id: string;
  relation: string;
  scopes: string[];
  consent_at: string;
  revoked_at: string | null;
  users: { full_name?: string; email?: string } | null;
};

type AttendanceRow = {
  id: string;
  student_id: string;
  date: string;
  status: string;
  classes: { name: string } | null;
};

// §3 + §5 — Parent portal link. A staff member (school_admin) creates a link
// between a parent-style auth.users row and a student. Parents can then read
// only their own linked students via their RLS policy.
export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.parent_user_id || !body.student_user_id)
    return NextResponse.json({ error: "parent_user_id, student_user_id required" }, { status: 400 });

  const { data: me } = await sb.from("users").select("tenant_id,role").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up" }, { status: 400 });
  if (!["school_admin", "it_admin", "platform_admin"].includes(me.role))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data, error } = await sb.from("parent_links").upsert({
    tenant_id: me.tenant_id,
    parent_user_id: body.parent_user_id,
    student_user_id: body.student_user_id,
    relation: body.relation ?? "guardian",
    scopes: body.scopes ?? ["attendance", "summary", "screen_time"]
  }, { onConflict: "parent_user_id,student_user_id" }).select("id,relation,scopes").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { data, error } = await sb.from("parent_links").update({ revoked_at: new Date().toISOString() })
    .eq("student_user_id", body.student_user_id ?? user.id)
    .eq("parent_user_id", body.parent_user_id ?? user.id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, revoked: data });
}

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: rawLinks, error } = await sb.from("parent_links")
    .select("id,parent_user_id,student_user_id,relation,scopes,consent_at,revoked_at,users!parent_links_student_user_id_fkey(full_name,email)")
    .eq("parent_user_id", user.id)
    .is("revoked_at", null)
    .order("consent_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const links = (rawLinks ?? []) as LinkRow[];
  const studentIds = links.map((link) => link.student_user_id);
  if (studentIds.length === 0) return NextResponse.json([]);

  const { data: attendance, error: attendanceError } = await sb.from("attendance")
    .select("id,student_id,date,status,classes(name)")
    .in("student_id", studentIds)
    .order("date", { ascending: false })
    .limit(200);
  if (attendanceError) return NextResponse.json({ error: attendanceError.message }, { status: 400 });

  const byStudent: Record<string, AttendanceRow[]> = {};
  for (const row of (attendance ?? []) as AttendanceRow[]) {
    (byStudent[row.student_id] ||= []).push(row);
  }

  const data = links.map((link: LinkRow) => {
    const recent = (byStudent[link.student_user_id] ?? []).slice(0, 5);
    const summary = recent.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return {
      ...link,
      attendance_summary: summary,
      recent_attendance: recent
    };
  });

  return NextResponse.json(data);
}
