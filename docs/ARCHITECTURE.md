# Architecture

```
Browser (Next.js app) ──┐                         ┌── Supabase Auth (email, OAuth/SSO)
Chrome/Edge extension ──┼─► Next.js route handlers ┼── PostgREST → Postgres (RLS + RPCs)
Integrations (REST v1) ─┘   (thin; auth + CORS)    ├── Realtime (postgres_changes + private broadcast)
                                                   └── Storage (lesson-media, submissions)
```

The browser talks to Supabase **directly** with the user's JWT; row-level security and RPC checks do the authorisation. Next.js route handlers exist only for things that need the server:

- the device-agent gateway (`/api/devices/*`), since the extension has no user session;
- file parsing for lesson import;
- email invites, auth-account deletion and billing, which need the service role;
- the REST v1 surface (`/api/v1/*`).

## Database layout (`supabase/migrations`)

| File | Contents |
|---|---|
| 0100 foundation | Plans, roles, tenants, settings, schools, users, classes, groups, invites, parent links, billing, audit, notifications, consents, and the `app.*` helpers |
| 0200 learning | Lessons, versions, slides, media library (full-text search), shares, activities, questions and options, rubrics, assignments, attempts and answers, submissions, grades, video checkpoints, collaboration boards |
| 0300 classroom & games | Sessions, presence (`student_presence` view), announcements, chat, raise-hand, spotlight, attendance, WebRTC rooms/peers/signals, game sessions/teams/players/answers, leaderboard history, anti-cheat flags |
| 0400 guard | Environment policies, scenes, domain categories, devices, enrolments, pairing codes, browser sessions and events, screen snapshots, environment events, off-task feedback and mutes, teacher commands |
| 0500 RLS | Policies for every table; anon locked out; column-level grants (e.g. `devices.secret_hash` is never selectable) |
| 0600–0650 RPCs | Accounts, Studio/Assess, games, Guard, classroom, insights and admin |
| 0660–0680 | UI read helpers, private realtime authorisation, audit triggers |
| 0700 | Realtime publication, storage buckets and policies |

### Isolation model

- Tables that belong to a tenant have `unique (id, tenant_id)`. Children reference parents with **composite** foreign keys, so a class session can't point at another school's class even if a UUID leaks.
- RLS policies call `SECURITY DEFINER` helpers with `search_path = ''`, such as `app.tenant_id()`, `app.can_manage_class()`, `app.in_session()` and `app.is_parent_of()`. They are wrapped as `(select …)` so each is evaluated once per statement.
- Writes that must preserve invariants (grading, scoring, codes, plan limits, commands, audit) have **no client INSERT/UPDATE policy**. They can only happen through RPCs.
- A trigger stops clients changing their own `role`, `tenant_id`, `status` or `email`.

## Key flows

**Grading.** `app.sanitize_question()` removes answer keys and always shuffles order-revealing lists. `app.grade_response()` grades MCQ, multi-select (with optional partial credit), fill-in-the-blank, matching, ordering and categorise questions automatically. Open, short, draw, file and code answers go to the review queue. Attempts store a random `seed`, which makes shuffling reproducible, and enforce deadlines on the server.

**Game scoring (§3.3).** Base score is `1000 × points`. The speed bonus is up to 50%, linear in the time remaining. The streak bonus is +100 per answer in a row, capped at +500. For **anti-lag normalisation**, the client-reported elapsed time is accepted only within `[server − 1.5 s, server]`: network delay never costs points, and a client can't claim to be much faster than the server saw. `unique(player_id, question_index)` locks each answer window. Suspiciously fast answers and clock mismatches are logged, never penalised.

**Policy engine (§14, §16).** `app.evaluate_url()` returns one of these verdicts:

- `allowed` or `neutral` (browser pages);
- `warning`: a soft notice to the student only;
- `violation`: from a blocked domain or category, or from focus/lock mode;
- `off_task`: an assistive alert with a confidence score.

Domain matching respects label boundaries: `example.com` matches `a.example.com` but never `badexample.com`. A violation must persist past the policy's grace period before an event fires. A partial unique index (`resolved_at is null`) deduplicates events. Returning to an allowed site resolves the event and tells the teacher.

A device that goes silent becomes `connection_lost` (severity info) when the teacher dashboard next polls; it is never a violation.

Teachers can dismiss, confirm or mute off-task alerts. That feedback adjusts future confidence per school and domain, and repeated dismissals suppress the alert.

**Device agent.** Pairing works like this: a student or IT admin creates an 8-character code that expires in 15 minutes and works once. The extension exchanges it for `(device_id, secret)`, and the database stores only `sha256(secret)`. Every agent call carries the secret. `device_tick()` is the single entry point: it updates presence, logs telemetry (only in a live session), evaluates policy, delivers queued commands and returns directives (capture interval, high-quality spotlight frames, notices). Commands expire after 2 minutes, and failed or expired ones can be retried (§30).

**Screens (§15).** Only the latest low-resolution thumbnail per device and session is kept. It is replaced in place and deleted when the session ends. Spotlight frames are higher quality and only exist while a spotlight is active. Event screenshots are off by default. Frames older than three capture intervals are shown as *unavailable*.

**Realtime.** Pages subscribe to `postgres_changes`, which respects RLS, to trigger refetches, and fall back to polling that pauses when the tab is hidden. Teacher annotation uses a *private* broadcast channel authorised by `realtime.messages` policies.

**Low bandwidth (§33).** Answers are queued in `localStorage` and synced on reconnect. Images are compressed before upload. Thumbnails are 480 px JPEGs. Polling slows down on slow connections. Teacher video is opt-in on slow connections. There is no chart library.

## Failure scenarios (§30)

| Scenario | Behaviour |
|---|---|
| Realtime down | Polling continues and the answer queue holds submissions |
| Extension disconnects | "Connection lost" event (info), never a violation; resolved on reconnect |
| Screen capture fails | Tile shows "unavailable", never a stale frame |
| Command times out | Status becomes `expired`, and the teacher can retry |
| Policy missing or unreadable | Verdict is `allowed` (fail open, non-destructive); the teacher sees no environment active |
| Leaderboard | Computed from stored answers on demand, so nothing is lost |
| Student reconnects | `start_attempt` resumes the in-progress attempt; `session_student_state` restores presence |
