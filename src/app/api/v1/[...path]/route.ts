import { createClient as createBase, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { logServerError } from "@/lib/api";
import { allow, clientIp } from "@/lib/rate-limit";
import { messageForError, statusForError, type RpcError } from "@/lib/errors";
import { createClient as cookieClient } from "@/lib/supabase/server";

/**
 * REST surface of blueprint §10 for integrations and native clients.
 * Auth: the browser session cookie, or `Authorization: Bearer <access_token>`
 * obtained from POST /api/v1/auth/login. Every handler runs as the caller, so
 * RLS and the RPC permission checks apply exactly as in the web app.
 */
type Ctx = { sb: SupabaseClient; params: string[]; body: Record<string, unknown>; url: URL; req: Request };
type Handler = (ctx: Ctx) => Promise<Response>;

const json = (data: unknown, status = 200) => NextResponse.json(data ?? null, { status, headers: { "Cache-Control": "no-store" } });
const err = (e: RpcError | { message: string; code?: string }, fallback = 400) =>
  json({ error: messageForError(e as RpcError), code: e.code }, e.code ? statusForError(e as RpcError) : fallback);

async function clientFor(req: Request): Promise<SupabaseClient> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return createBase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return cookieClient();
}

async function rpc(sb: SupabaseClient, fn: string, args: Record<string, unknown>, status = 200) {
  const { data, error } = await sb.rpc(fn, args);
  return error ? err(error) : json(data, status);
}

async function me(sb: SupabaseClient) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("users").select("id,tenant_id,role").eq("id", user.id).maybeSingle();
  return data as { id: string; tenant_id: string; role: string } | null;
}

const LESSON_FIELDS = ["title", "description", "subject", "grade_level", "status", "default_mode", "is_template"];
const ACTIVITY_FIELDS = ["kind", "title", "instructions", "settings"];
const ENV_FIELDS = ["name", "description", "allowed_domains", "blocked_domains", "blocked_categories", "required_urls", "lesson_url", "focus_mode", "lock_screen", "tab_limit", "grace_seconds", "idle_seconds", "subject", "notify", "is_template"];
const pick = (b: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in b).map((k) => [k, b[k]]));

// [method, pattern, handler]; ":x" segments are captured in order.
const ROUTES: [string, string, Handler][] = [
  // 10.1 Authentication
  ["POST", "auth/login", async ({ body, req }) => {
    // Every login reaches Supabase from this server's address, so limit per caller here:
    // otherwise one client could guess passwords, or use up the shared allowance for everyone.
    const email = String(body.email ?? "").toLowerCase();
    if (!allow(`v1-login-ip:${clientIp(req)}`, 10) || !allow(`v1-login-email:${email}`, 5)) {
      return json({ error: "Too many sign-in attempts. Wait a minute and try again." }, 429);
    }
    const sb = createBase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.signInWithPassword({ email: String(body.email ?? ""), password: String(body.password ?? "") });
    if (error || !data.session) return json({ error: error?.message ?? "Invalid login" }, 401);
    return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at, user_id: data.user.id });
  }],
  ["POST", "auth/logout", async ({ sb }) => { await sb.auth.signOut(); return json({ ok: true }); }],
  ["POST", "auth/refresh", async ({ body, req }) => {
    if (!allow(`v1-refresh-ip:${clientIp(req)}`, 30)) return json({ error: "Too many requests." }, 429);
    const sb = createBase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.refreshSession({ refresh_token: String(body.refresh_token ?? "") });
    if (error || !data.session) return json({ error: error?.message ?? "Invalid refresh token" }, 401);
    return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at });
  }],
  ["POST", "auth/sso/callback", async ({ sb, body }) => {
    const { error } = await sb.auth.exchangeCodeForSession(String(body.code ?? ""));
    return error ? json({ error: error.message }, 401) : json({ ok: true });
  }],
  ["GET", "me", ({ sb }) => rpc(sb, "me", {})],

  // 10.2 Lessons
  ["GET", "lessons", async ({ sb, url }) => {
    let q = sb.from("lessons").select("id,title,status,subject,is_template,current_version,updated_at").order("updated_at", { ascending: false }).limit(Math.min(Number(url.searchParams.get("limit") ?? 50), 200));
    if (url.searchParams.get("status")) q = q.eq("status", url.searchParams.get("status")!);
    const { data, error } = await q;
    return error ? err(error) : json(data);
  }],
  ["POST", "lessons", async ({ sb, body }) => {
    const m = await me(sb);
    if (!m) return json({ error: "Sign in first." }, 401);
    const { data, error } = await sb.from("lessons").insert({ ...pick(body, LESSON_FIELDS), tenant_id: m.tenant_id, owner_id: m.id }).select("*").single();
    return error ? err(error) : json(data, 201);
  }],
  ["GET", "lessons/:id", async ({ sb, params }) => {
    const { data, error } = await sb.from("lessons").select("*,lesson_slides(id,position,kind,content,notes,activity_id),activities(id,kind,title,instructions,settings)").eq("id", params[0]).maybeSingle();
    if (error) return err(error);
    return data ? json(data) : json({ error: "Not found" }, 404);
  }],
  ["PATCH", "lessons/:id", async ({ sb, params, body }) => {
    const { data, error } = await sb.from("lessons").update(pick(body, LESSON_FIELDS.filter((f) => f !== "status"))).eq("id", params[0]).select("*").maybeSingle();
    if (error) return err(error);
    return data ? json(data) : json({ error: "Not found or not yours" }, 404);
  }],
  ["POST", "lessons/:id/publish", ({ sb, params }) => rpc(sb, "publish_lesson", { p_lesson: params[0] })],
  ["POST", "lessons/:id/duplicate", ({ sb, params, body }) => rpc(sb, "duplicate_lesson", { p_lesson: params[0], p_title: body.title ?? null, p_as_template: body.as_template === true }, 201)],
  ["POST", "lessons/import", async () => json({ error: "Send multipart/form-data with a `file` field to POST /api/lessons/import." }, 400)],

  // 10.3 Activities
  ["POST", "lessons/:id/activities", async ({ sb, params, body }) => {
    const m = await me(sb);
    if (!m) return json({ error: "Sign in first." }, 401);
    const { data, error } = await sb.from("activities").insert({ ...pick(body, ACTIVITY_FIELDS), tenant_id: m.tenant_id, owner_id: m.id, lesson_id: params[0] }).select("*").single();
    return error ? err(error) : json(data, 201);
  }],
  ["PATCH", "activities/:id", async ({ sb, params, body }) => {
    const { data, error } = await sb.from("activities").update(pick(body, ACTIVITY_FIELDS.filter((f) => f !== "kind"))).eq("id", params[0]).select("*").maybeSingle();
    if (error) return err(error);
    return data ? json(data) : json({ error: "Not found or not yours" }, 404);
  }],
  ["DELETE", "activities/:id", async ({ sb, params }) => {
    const { error, count } = await sb.from("activities").delete({ count: "exact" }).eq("id", params[0]);
    if (error) return err(error);
    return count ? json({ deleted: true }) : json({ error: "Not found or not yours" }, 404);
  }],
  ["POST", "activities/:id/launch", ({ sb, params, body }) => rpc(sb, "set_session_state", { p_session: body.session_id, p_activity: params[0] })],
  ["POST", "activities/:id/responses", async ({ sb, params, body }) => {
    const { data: att, error } = await sb.rpc("start_attempt", { p_activity: params[0], p_session: body.session_id ?? null, p_assignment: body.assignment_id ?? null });
    if (error) return err(error);
    return rpc(sb, "submit_answer", { p_attempt: (att as { attempt: { id: string } }).attempt.id, p_question: body.question_id, p_response: body.response, p_elapsed_ms: body.elapsed_ms ?? null }, 201);
  }],
  ["GET", "activities/:id/results", ({ sb, params, url }) => rpc(sb, "activity_results", { p_activity: params[0], p_session: url.searchParams.get("session_id") })],

  // 10.4 Games
  ["POST", "games", ({ sb, body }) => rpc(sb, "create_game", { p_class: body.class_id, p_activity: body.activity_id, p_settings: body.settings ?? {}, p_session: body.session_id ?? null, p_title: body.title ?? null }, 201)],
  ["POST", "games/:id/join", async ({ sb, params, body }) => {
    const { data } = await sb.from("game_sessions").select("join_code").eq("id", params[0]).maybeSingle();
    if (!data) return json({ error: "Game not found" }, 404);
    return rpc(sb, "join_game", { p_code: data.join_code, p_nickname: body.nickname ?? null });
  }],
  ["POST", "games/:id/start", ({ sb, params }) => rpc(sb, "game_control", { p_game: params[0], p_action: "start" })],
  ["POST", "games/:id/next", ({ sb, params }) => rpc(sb, "game_control", { p_game: params[0], p_action: "next" })],
  ["POST", "games/:id/answer", ({ sb, params, body }) => rpc(sb, "game_answer", { p_game: params[0], p_index: body.question_index, p_choice: body.choice, p_client_elapsed_ms: body.client_elapsed_ms ?? null })],
  ["GET", "games/:id", ({ sb, params }) => rpc(sb, "game_state", { p_game: params[0] })],
  ["GET", "games/:id/leaderboard", ({ sb, params, url }) => rpc(sb, "game_leaderboard", { p_game: params[0], p_limit: Number(url.searchParams.get("limit") ?? 10) })],
  ["POST", "games/:id/end", ({ sb, params }) => rpc(sb, "game_control", { p_game: params[0], p_action: "end" })],

  // 10.5 Classroom
  ["POST", "class-sessions", ({ sb, body }) => rpc(sb, "start_session", { p_class: body.class_id, p_lesson: body.lesson_id ?? null, p_mode: body.mode ?? "live_participation", p_title: body.title ?? null, p_environment: body.environment_id ?? null }, 201)],
  ["POST", "class-sessions/:id/start", async ({ sb, params }) => {
    const { data } = await sb.from("class_sessions").select("id,status,join_code").eq("id", params[0]).maybeSingle();
    if (!data) return json({ error: "Session not found" }, 404);
    return data.status === "live" ? json(data) : json({ error: "Session has ended; create a new one." }, 409);
  }],
  ["POST", "class-sessions/:id/end", ({ sb, params }) => rpc(sb, "end_session", { p_session: params[0] })],
  ["POST", "class-sessions/join", ({ sb, body }) => rpc(sb, "join_session", { p_code: body.code })],
  ["GET", "class-sessions/:id/presence", async ({ sb, params }) => {
    const { data, error } = await sb.rpc("teacher_session_state", { p_session: params[0] });
    return error ? err(error) : json((data as { roster: unknown }).roster);
  }],
  ["GET", "class-sessions/:id/screens", ({ sb, params }) => rpc(sb, "session_screens", { p_session: params[0] })],
  ["POST", "class-sessions/:id/announcements", async ({ sb, params, body }) => {
    const m = await me(sb);
    const { data: s } = await sb.from("class_sessions").select("class_id,tenant_id").eq("id", params[0]).maybeSingle();
    if (!m || !s) return json({ error: "Session not found" }, 404);
    const { data, error } = await sb.from("announcements").insert({ tenant_id: s.tenant_id, class_id: s.class_id, session_id: params[0], author_id: m.id, body: body.body }).select("*").single();
    return error ? err(error) : json(data, 201);
  }],
  ["POST", "class-sessions/:id/commands", ({ sb, params, body }) => rpc(sb, "issue_command", { p_session: params[0], p_students: body.student_ids, p_kind: body.kind, p_payload: body.payload ?? {} }, 201)],

  // 10.6 Device (teacher/IT side; agent endpoints live at /api/devices/*)
  ["GET", "devices/:id/status", ({ sb, params }) => rpc(sb, "device_diagnostics", { p_device: params[0] })],
  ["POST", "devices/:id/commands", async ({ sb, params, body }) => {
    const { data: d } = await sb.from("devices").select("student_id").eq("id", params[0]).maybeSingle();
    if (!d?.student_id) return json({ error: "Device not found or unassigned" }, 404);
    return rpc(sb, "issue_command", { p_session: body.session_id, p_students: [d.student_id], p_kind: body.kind, p_payload: body.payload ?? {} }, 201);
  }],
  ["POST", "devices/:id/screenshot-request", async ({ sb, params, body }) => {
    const { data: d } = await sb.from("devices").select("student_id").eq("id", params[0]).maybeSingle();
    if (!d?.student_id) return json({ error: "Device not found or unassigned" }, 404);
    return rpc(sb, "request_screenshot", { p_session: body.session_id, p_student: d.student_id });
  }],

  // 10.7 Environment
  ["POST", "environments", async ({ sb, body }) => {
    const m = await me(sb);
    if (!m) return json({ error: "Sign in first." }, 401);
    const { data, error } = await sb.from("environment_policies").insert({ ...pick(body, ENV_FIELDS), tenant_id: m.tenant_id, owner_id: m.id }).select("*").single();
    return error ? err(error) : json(data, 201);
  }],
  ["PATCH", "environments/:id", async ({ sb, params, body }) => {
    const { data, error } = await sb.from("environment_policies").update(pick(body, ENV_FIELDS)).eq("id", params[0]).select("*").maybeSingle();
    if (error) return err(error);
    return data ? json(data) : json({ error: "Not found or not yours" }, 404);
  }],
  ["POST", "class-sessions/:id/environment/start", ({ sb, params, body }) => rpc(sb, "start_environment", { p_session: params[0], p_policy: body.environment_id })],
  ["POST", "class-sessions/:id/environment/stop", ({ sb, params }) => rpc(sb, "stop_environment", { p_session: params[0] })],
  ["GET", "class-sessions/:id/environment-events", async ({ sb, params }) => {
    const { data, error } = await sb.from("environment_events").select("*").eq("class_session_id", params[0]).order("created_at", { ascending: false }).limit(500);
    return error ? err(error) : json(data);
  }],
  ["POST", "environment-events/:id/acknowledge", ({ sb, params, body }) => rpc(sb, "handle_environment_event", { p_event: params[0], p_action: body.action ?? "acknowledge", p_scope: body.scope ?? "student" })]
];

function match(method: string, path: string[]): { handler: Handler; params: string[] } | null {
  for (const [m, pattern, handler] of ROUTES) {
    if (m !== method) continue;
    const segs = pattern.split("/");
    if (segs.length !== path.length) continue;
    const params: string[] = [];
    if (segs.every((s, i) => (s.startsWith(":") ? (params.push(path[i]!), true) : s === path[i]))) return { handler, params };
  }
  return null;
}

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const route = match(req.method, path);
  if (!route) return json({ error: "Not found", see: "/docs/API.md" }, 404);
  let body: Record<string, unknown> = {};
  if (req.method !== "GET" && req.method !== "DELETE") {
    const text = await req.text();
    if (text.length > 1_000_000) return json({ error: "Payload too large" }, 413);
    try { body = text ? JSON.parse(text) : {}; } catch { return json({ error: "Invalid JSON" }, 400); }
  }
  try {
    return await route.handler({ sb: await clientFor(req), params: route.params, body, url: new URL(req.url), req });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logServerError(`${err.name}: ${err.message}`, err.stack, "api", new URL(req.url).pathname);
    return json({ error: "Something went wrong. The problem has been reported." }, 500);
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
