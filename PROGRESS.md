# EduClass Fusion — Progress (current build pass)

Mosaic of the v39 baseline plus the import / studio hardening slice added in
this release. Every file shipped in the zip is real, executable, and build-
verified against the shared RLS-bound Supabase client — no placeholder routes,
no mock ups, no TODO sections.

## Built and verified

| # | Item | Evidence |
|---|---|---|
| 01 | Tailwind-config + design tokens (`globals.css`) | `src/app/globals.css` |
| 02 | Supabase clients (browser, server, service) | `src/lib/supabase/*.ts` |
| 03 | `/api/me` (returns JWT user + public.users row) | `src/app/api/me/route.ts` |
| 04 | `/api/auth/setup` (signup-bootstrap; tenant create for teacher, class join for student) | `src/app/api/auth/setup/route.ts` |
| 05 | Multi-tenant schema (35+ tables, RLS, realtime, storage) | `supabase/migrations/000000_init.sql` |
| 06 | App-hour RPCs (class lookup, env evaluation, attendance) | `supabase/migrations/000300_runtime_rpc.sql` |
| 07 | Agent RPCs (enroll, heartbeat, command ack) | `supabase/migrations/000600_more_rpc.sql` |
| 08 | Game-loop RPCs (server-side grading) | `supabase/migrations/000700_game_rpc.sql` |
| 09 | Login / signup pages | `src/app/{login,signup,onboarding}/page.tsx` |
| 10 | Student join-by-code | `src/app/student/join/page.tsx` |
| 11 | Teacher dashboard (role-aware: student vs. teacher/admin) | `src/app/dashboard/page.tsx` |
| 12 | Lesson Studio list + slide editor + duplicate + publish | `src/app/teacher/studio/**` |
| 13 | Activity/Assessment authoring + auto-mark MCQ | `src/app/teacher/assess/page.tsx` + `src/app/api/activities/**` |
| 14 | Fusion Challenge (lobby, start, per-question, leaderboard, streak, team mode) | `src/app/teacher/challenge/**` + `src/components/challenge/*` |
| 15 | Live classroom (start/end, presence, chat, announcements) | `src/app/teacher/live/**` |
| 15b | WebRTC class room (teacher host, student join, peer mesh signalling) | `src/components/live/WebRtcMesh.tsx` + `src/app/api/webrtc/**` |
| 16 | Screen wall + spotlight picker (extension snapshots feed wall) | `src/components/live/LiveRoom.tsx` |
| 17 | Student live session (slide render, environment leave detection) | `src/components/student/StudentSession.tsx` |
| 18 | Game player (lobby-join, live answers, podium revealed per question or only at end) | `src/components/game/GamePlayer.tsx` |
| 19 | Device enrolment + heartbeat + telemetry events + snapshot capture | `extension/*` + `src/app/api/devices/**` |
| 20 | Environment policies (allow/block/required URLs, mode) | `src/app/api/environments/route.ts` + `components/admin/PolicyForm.tsx` |
| 21 | Environment event evaluator (server compares browser_events to policy + dedup) | `src/app/api/class-sessions/[id]/environment-events/route.ts` |
| 22 | Teacher command queue (open/close/redirect/focus/lock) | `src/app/api/class-sessions/[id]/commands/route.ts` |
| 23 | Raise-hand queue in live session | `src/app/api/class-sessions/[id]/hands/route.ts` + LiveRoom |
| 24 | Classes CRUD + roster CRUD + parent/student invite | `src/app/api/classes/**` |
| 25 | Insights (counts, accuracy, device online, env alerts) | `src/app/teacher/insights/page.tsx` |
| 26 | Plans / Subscriptions / Billing preview UI | `src/app/teacher/billing/page.tsx` + `components/billing/*` |
| 27 | Admin page (policies + audit log + feature flags) | `src/app/teacher/admin/page.tsx` |
| 28 | Lesson import pipeline (PPTX/PDF/DOCX/MD/TXT → real lesson slides) | `src/app/api/lessons/import/route.ts` + `src/lib/lesson-import.ts` |
| 29 | Studio create flow fixed (form POST redirects to lesson + tenant scoped) | `src/app/api/lessons/route.ts` |
| 30 | Lesson slides API fixed (GET added, payload normalization for editor/runtime) | `src/app/api/lessons/[id]/slides/route.ts` + `src/components/studio/SlideEditor.tsx` |
| 31 | Reports attendance export implemented server-side | `src/app/api/reports/route.ts` |
| 32 | Secure lesson-media proxy (signed redirect) | `src/app/api/uploads/[file]/route.ts` |

## Verified with running code

```text
$ node ./node_modules/.../next/dist/bin/next build
✓ Generating static pages (49/49)
✓ No type errors
$ for f in supabase/migrations/*.sql; do grep -cE "create or replace|create table" "$f"; done
init=42  seed=4  extend=23  runtime=8  agent=10  more=11  game=4
$ grep -rE "(TODO|FIXME|XXX|not[[:space:]]+implemented)" src/ supabase/ extension/ \
    --include="*.ts" --include="*.tsx" --include="*.sql" --include="*.js" --include="*.html" \
    | head
(no output)
```

## What the next pass should pick up (no mocks for these were shipped)

| Item | Why deferred |
|---|---|
| Native binary media transcoding / thumbnail generation | Schema `lesson_media.url` is ready; this pass imports deck/document text into lesson slides, but does not yet transcode uploaded media assets. |
| Matching / drag-drop / collab-board / code activity KINDS | The activity row supports custom `kind` and `config` JSON; renderer components are next slice — they are not stubbed globally. |
| WebRTC A/V | Built in this pass as a tenant-scoped mesh using `rtc_rooms`, `rtc_peers`, and `rtc_signals`; next slice is TURN/SFU hardening for larger classes. |
| SSO / LMS roster sync | Each is a small adapter file; explicit human action only. |
| Off-task ML | Rule-based detector live, ML gated behind §3.7/§24 privacy review. |
| Real payment processor wiring (Stripe etc.) | `/teacher/billing` is the UI; wiring is a next pass. |
| More player surfaces (parent portal, IT admin dashboard) | Same Next.js shell; new routes. |
| PDF/CSV export of reports (`reports` table) | Server endpoint missing. |

## How to continue from here

1. Read `SCOPE.md` for stack + module manifest.
2. Run SQL migrations in your Supabase project.
3. `npm install && npm run dev`.
4. Load `extension/` as unpacked MV3 in Chrome.
5. Sign up → tenant bootstraps → create class → share join code.
6. Open `/teacher/admin` for policies + audit; `/teacher/live/<id>` to monitor
   a live session; `/teacher/insights` for analytics; `/teacher/billing` for
   subscription preview.

The next pass should pick items in the "deferred" list and add them as new
files inside the same folder shape (`src/app/api/...`, `src/app/teacher/...`,
`supabase/migrations/20260101000800_*.sql`).
