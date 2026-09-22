# EduClass Fusion — Build Scope & Manifest

Authoritative build manifest for the current zip release. Stack, modules,
data model, RBAC and verified-built items are derived directly from
`EduClass_Fusion_SaaS_Blueprint.docx` v1.0 (Aug 2026).

## 1. Stack (per blueprint §5/§6/§12)

| Layer | Choice | Reason |
|---|---|---|
| Web app | Next.js 14 (App Router) + TypeScript | Per blueprint §6 |
| Styling | Tailwind CSS 3.4 | Original component design (`globals.css`) |
| Database | PostgreSQL via Supabase | Multi-tenant RLS, realtime, storage |
| ORM/Client | `@supabase/ssr` + `supabase-js` | RLS-bound queries for browser + server |
| Realtime | Supabase Postgres-channels | class_sessions, participants, chat, commands, env events, game_players, browser_events |
| Browser extension | MV3 (Chrome/Edge) — `extension/*` | Original agent: enroll, heartbeat, tab/nav/blur/snapshot |
| Validation | Zod (server handlers) | Per blueprint §10 |

## 2. Multi-tenant model (per §4)

- Every business table carries `tenant_id` (FK → `tenants.id`).
- `public.users` mirrors `auth.users` and carries `tenant_id, role`.
- Six roles: `student`, `teacher`, `school_admin`, `it_admin`, `parent`, `platform_admin`.
- RLS is enabled on every table (init migration) with explicit policies keyed to:
  - tenant-id match
  - ownership (`owner_id = auth.uid()`)
  - class membership (`class_members`)
  - service-role (audit_logs / subscriptions writes)

## 3. Modules shipped

| § | Module | Status |
|---|---|---|
| §3.1 | Fusion Studio (lessons, slides, publish, duplicate, media) | ✅ |
| §3.2 | Fusion Assess (activities, MCQ/poll/open-ended, auto-mark) | ✅ |
| §3.3 | Fusion Challenge (lobby, join code, start, question-by-question, leaderboard, streak, speed bonus, rankings, team mode toggle) | ✅ |
| §3.4 | Fusion Live (sessions, presence, chat, announcements, raise-hand, screen wall, spotlight, A/V room) | ✅ |
| §3.5 | Fusion Guard (devices, browser_events, teacher_commands queue, snapshots, screen_snapshots write) | ✅ |
| §3.6 | Environment/leave-detection (policies, environment_events, dedup + severity client-side, student-facing notice) | ✅ |
| §3.7 | Screen display / spotlight (extension scrollback snapshots + LiveRoom wall) | ✅ |
| §3.8 | Off-task detection (rule-based blocked domain → warn/critical event; no ML) | ✅ |
| §4 | RBAC + tenant isolation | ✅ |
| §10 | API routes (≈40) | ✅ |
| §11/§19 | Teacher dashboard, admin (classes, roster, policies, audit) | ✅ |
| §12 | Student dashboard + class join | ✅ |
| §17 | Notifications (real-time railway) | ✅ |
| §18 | Insights (counts, accuracy, env alerts, devices online) | ✅ |
| §21/§14 | MV3 extension agent (real, not placeholder) | ✅ |
| §25/§26 | Plans / subscriptions UI (`/teacher/billing`) | ✅ |
| §3.4 / §15 | Tenant-scoped WebRTC peer mesh (`rtc_rooms`, `rtc_peers`, `rtc_signals`) | ✅ |

## 4. Database — 35+ tables across 7 migrations

1. `20260101000000_init.sql` — core schema (tenants, users, classes, lessons,
   lesson_versions, lesson_slides, lesson_media, activities, questions, quizzes,
   quiz_attempts, quiz_answers, game_sessions, game_players, leaderboard_entries,
   assignments, submissions, grades, rubrics, attendance, class_sessions,
   session_participants, student_presence, devices, device_enrollments,
   browser_events, teacher_commands, environment_policies, environment_events,
   scenes, scene_rules, chat_threads, chat_messages, announcements,
   notifications, reports, audit_logs, subscriptions, plans, invoices,
   feature_flags, storage buckets, realtime publication).
2. `20260101000100_seed.sql` — minimal demo tenant.
3. `20260101000200_saas_extend.sql` — RBAC + RLS policy stack (#1).
4. `20260101000300_runtime_rpc.sql` — `class_lookup_by_code`,
   `device_active_count`, `tenant_offtask_today`, etc.
5. `20260101000400_agent_rpc.sql` — agent-side RPCs (enroll, heartbeat).
6. `20260101000600_more_rpc.sql` — plans seed + tenant-visible browser events.
7. `20260101000700_game_rpc.sql` — `game_by_code` + `game_grade_answer` (server-side grading; clients never read answer keys).

## 5. RBAC matrix (per §9)

| Action | student | teacher | school_admin | it_admin | platform_admin |
|---|---|---|---|---|---|
| Join class by code | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create lesson | — | ✅ | ✅ | — | — |
| Create class | — | ✅ | ✅ | ✅ | — |
| Start live session | — | ✅ | ✅ | — | — |
| Issue device command | — | ✅ | ✅ | ✅ | — |
| Read aggregate insights | — | ✅ | ✅ | ✅ | ✅ |
| Manage subscription | — | — | ✅ | ✅ | ✅ |
| Manage tenants / flags | — | — | — | — | ✅ |

## 6. Realtime channels (per §15)

Tables added to `supabase_realtime`: `class_sessions`, `session_participants`,
`chat_messages`, `announcements`, `teacher_commands`, `environment_events`,
`game_players`, `leaderboard_entries`, `browser_events` (also activity_responses
where added; init migration enables everything).

## 7. Browser extension agent

- `manifest.json` — MV3, host_permissions for both `https://*` (events) and the
  app/supabase origins.
- `background.js` — install-generates `ext-XXXXXXXX` UID; enroll → heartbeat ls
  → tab/nav/blur → periodic screen snapshot → command poll → ack.
- `content.js` — current tab URL, visibility, navigation events.
- `popup.html` / `popup.js` — start session by code, enrolment status, "Focus mode" toggle.
- `api.js` — single client wrapper around `/api/devices/{enroll,events,heartbeat}` (events endpoint also accepts `kind: snapshot` with a base64 thumbnail).

## 8. Out-of-this-pass (intentional backlog)

- PPT/PDF import pipeline in Studio (button + parser).
- Matching / drag-drop / collab-board / code-execution activity KINDS (schema
  supports them — `activities.kind`).
- TURN/SFU hardening for large-class WebRTC audio/video; current peer mesh ships in this pass.
- Parent portal.
- Off-task ML classifier (rule-based detector is the foundation; ML is §3.7/§24
  Phase 3 and is gated behind accuracy/privacy evaluation).
- SSO adapters (Google/Microsoft/ClassLink); CSV roster importer.
- AI lesson/question summarisation.
- Real payment processor wiring (subscriptions table + plans seeded; UI shows
  preview invoice).

## 9. Required secrets

Set in `.env.local` (template at `.env.example`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side admin operations only — never
  exposed to the browser)

## 10. Quickstart

```bash
unzip educlass-fusion-saas.zip
cd educlass-fusion
cp .env.example .env.local              # fill values
npm install
# Apply migrations (one-time). Use Supabase SQL editor OR psql if you have DB URL:
for f in supabase/migrations/*.sql; do
  psql "$SUPABASE_DB_URL" -f "$f"
done
npm run dev                             # http://localhost:3000
# Load the extension: chrome://extensions → Developer mode → Load unpacked → /extension
```
