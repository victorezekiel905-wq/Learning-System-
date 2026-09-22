# EduClass Fusion — Build Status

Contract for the active build. Stack: **Next.js 14 (App Router, TypeScript, Tailwind) + Supabase (PostgreSQL, RLS, Realtime)** + **MV3 browser extension (Chrome/Edge)**. Original implementation per `EduClass_Fusion_SaaS_Blueprint.docx` v1.0 — no cloned vendor code/UI.

## Blueprint inventory → build mapping

| Blueprint § | Module | Status |
|---|---|---|
| §3.1 | Lesson Studio (slides, versions, publish) | ✅ built — extended: duplicate, fixed studio create flow, real slides API, PPTX/PDF/DOCX/MD/TXT import |
| §3.2 | Activity/Assessment engine | ✅ built (v36) — extended: `activity_responses` (student answering), auto-mark MCQ |
| §3.3 | Game-based quiz (Fusion Challenge) | 🟡 v36 had lobby+leaderboard only — **added**: start, question flow, student answer screen, leaderboard API, per-question state on `game_sessions` |
| §3.4 | Live classroom | ✅ built — **extended**: raise-hand queue, environment alert feed w/ acknowledge, screen thumbnails on the wall, teacher/student A/V room join flow |
| §3.5 | Device monitoring (Fusion Guard) | 🟡 v36 enrollment UI only — **added**: real extension agent (enroll/heartbeat/tab events/snapshots), device metadata, command poll+execute+ack |
| §3.6 | Environment/leave detection | 🟡 schema existed — **added**: server evaluates blocked/required URLs via extension events; severity + dedup client-side; student-facing notice |
| §3.7 | Screen display / spotlight | 🟡 **added**: snapshot wall on LiveRoom + spotlight pick (privacy notice on student side) |
| §3.8 | Off-task detection (rule-based) | 🟡 **added**: blocked-domain → `warn`/`critical` event; no ML, no auto-discipline |
| §4 | RBAC + tenant isolation | 🟡 v36 RLS partial — **added**: `users_insert`, `tenants_insert`, `class_members` policies, security-definer class lookup |
| §5/§6 | Multi-tenant architecture / stack | ✅ Next.js + Supabase as specified |
| §7/§8 | Data model | ✅ 35+ tables; **added**: activity_responses, raise_hands, screen_snapshots, devices metadata, game question state |
| §10 | API blueprint | 🟡 v36 ~21 routes — **added**: auth/setup, classes CRUD+roster, games start/leaderboard/question, activities responses, session hands, env-events acknowledge, devices commands/snapshots, lessons duplicate, subscriptions |
| §11 | Teacher dashboard UX | 🟡 **added**: `/dashboard` (role-aware), `/teacher/classes` + roster, `/teacher/insights`, `/teacher/billing` |
| §12 | Student dashboard UX | 🟡 **added**: `/student/dashboard` (upcoming sessions, scores), `/student/game/[id]` play flow |
| §17 | Notifications | ✅ notifications table + banner feeds (mark-read policy added) |
| §18 | Analytics | 🟡 **added**: `/teacher/insights` — participation, question accuracy, response counts, environment alerts, device connectivity |
| §19 | School admin | ✅ classes/roster/policies on `/teacher/classes` + `/teacher/admin`; CSV roster import built, SSO pending |
| §21/§14 | Browser extension agent | 🟡 v36 popup/api.js were placeholders — **rewritten**: real agent (MV3) with enroll, heartbeat alarm, tab change reporting, snapshot capture, command execution, ack |
| §22 | MVP list | ✅ complete after this build |
| §25/§26 | Plans & billing metrics | 🟡 **added**: plans/subscription/invoices UI (`/teacher/billing`); real rows, sandbox checkout only |
| §30/§31 | Failure scenarios / metrics | ✅ design notes; connection-loss ≠ violation handled |
| §3.4 / §15 | WebRTC A/V | 🟡 before: local loopback proof only — **added**: tenant-scoped room/peer/signal API, student join page, teacher host/close controls, STUN-backed browser mesh |

## Known bugs fixed this build

1. `POST /api/lessons` no longer stranded users on a JSON response or risked missing tenant scope — it now creates tenant-scoped lessons and redirects Studio form submissions into the new lesson.
2. `/student/join` read `session_id` from `/api/class-sessions/lookup` which returns `id` → student join always failed. Fixed.
3. Device enrollment used `user.id` as `tenant_id` → wrong tenant. Now resolves tenant from the signed-in user's `users` row; optional `label`/`os`/`browser` metadata stored.
4. Signup created an `auth.users` row only — no `public.users` row → RLS denied everything afterwards. Added `users_insert` policy + `/api/auth/setup` bootstrap (teacher → creates tenant; student → joins class by code).
5. `class_members` had RLS enabled with **no policies** → no roster reads/writes. Added select/insert policies.

## Verified

- `npm run build` passes for the full Next.js app (type-check + compile).
- Added and build-verified `/api/webrtc/peers`, `/api/webrtc/signals`, `/teacher/live/[id]/webrtc`, `/student/live/[id]/webrtc`, and migration `20260101001000_webrtc_mesh.sql`.
- Extension is static MV3 (load unpacked; no build step).
- Two migrations: `20260101000000_init.sql` (base) + `20260101000200_saas_extend.sql` (this build). Seed optional.

## Not built (Phase 2/3, per blueprint)

- Interactive video with timestamped questions already built; next media slice is binary asset ingest/transcoding for uploaded videos/images.
- Matching/drag-drop/collab-board/code-execution activity kinds are built; the next slice is richer grading/rubrics and teacher review UX.
- WebRTC audio/video hardening · SSO/OIDC · real payment processing · AI generation · ML off-task classification
- AI lesson/question generation · ML off-task classification (explicitly gated behind privacy/accuracy testing in blueprint §3.8/§24)
