import { randomUUID } from "node:crypto";
import { fail, ok, readJson, withErrorLog } from "@/lib/api";
import { allow, clientIp } from "@/lib/rate-limit";
import { GUEST_LOGIN_DOMAIN } from "@/lib/student-login";
import { createServiceClient, explainServiceError, hasServiceRole } from "@/lib/supabase/service";

/**
 * Guest sign-in when Supabase's anonymous sign-ins are off or busy (migration 1000).
 * For a live lesson's code only: makes a guest-only account (app_metadata.guest,
 * which only the service key can set) and returns a one-time sign-in token. The
 * browser exchanges it itself, so Supabase counts it against the school's
 * address, not this server's. The guest then joins with join_session_as_guest.
 */
export const POST = withErrorLog(async function POST(req: Request) {
  if (!hasServiceRole()) return fail(503, "Joining with just a name isn't set up on this site yet. Tell your teacher, or sign in with your school account.");
  const ip = clientIp(req);
  // A school shares one address, so a whole class can join at once.
  if (!allow(`guest-ip:${ip}`, 120) || !allow("guest-all", 1200)) {
    return fail(429, "Lots of people are joining from this network right now. Wait a minute and try again, or tell your teacher.");
  }
  const body = await readJson<{ code?: string }>(req, 1_000);
  const code = (body?.code ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (code.length < 6 || code.length > 8) return fail(400, "Enter the code on your teacher's screen.");

  const admin = createServiceClient();
  const { data: s, error: sErr } = await admin.from("class_sessions")
    .select("guests_closed, tenant_id").eq("join_code", code).eq("status", "live").maybeSingle();
  if (sErr) return fail(500, explainServiceError(sErr.message));
  const school = s && (await admin.from("tenants").select("status").eq("id", s.tenant_id).maybeSingle()).data;
  if (!s || school?.status !== "active") {
    // Wrong codes are limited harder, so codes can't be guessed through here.
    if (!allow(`guest-miss:${ip}`, 10)) return fail(429, "Too many wrong codes. Wait a minute, then check the code with your teacher.");
    return fail(404, "No live lesson has that code. Check it with your teacher.", { code: "P0002" });
  }
  if (s.guests_closed) return fail(409, "This lesson isn't taking new guests. Ask your teacher.");

  const email = `guest-${randomUUID()}@${GUEST_LOGIN_DOMAIN}`;
  const made = await admin.auth.admin.createUser({ email, email_confirm: true, app_metadata: { guest: true } });
  if (made.error || !made.data.user) return fail(500, explainServiceError(made.error?.message));
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) return fail(500, explainServiceError(error?.message));
  return ok({ token_hash: link.properties.hashed_token }, { headers: { "Cache-Control": "no-store" } });
});
