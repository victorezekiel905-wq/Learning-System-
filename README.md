# SwiftCipher

SwiftCipher is a multi-tenant classroom platform for schools. It combines interactive lessons, live assessment, competitive quizzes and school-managed device focus in one workspace. It is an original implementation of the *EduClass Fusion Product & Technical Blueprint v1.0*.

**Stack:** Next.js 14 (App Router, TypeScript, Tailwind), Supabase (Postgres, Auth, Realtime, Storage), and a Chrome/Edge extension (Manifest V3).

| Module | What it does |
|---|---|
| **Studio** | Lesson editor with 11 slide types: text, image, video with checkpoint questions, audio, embed, link, attachment, shapes, whiteboard and activity. Also covers the media library, PPTX/PDF/DOCX import, versioning, templates and expiring share links. |
| **Assess** | 12 activity types backed by 13 question types, all marked on the server. Answer keys never reach students. Includes question bank, randomisation, attempts, time limits, review queue, rubrics and assignments. |
| **Challenge** | Quiz games with speed bonuses that don't penalise network lag, streaks, teams, podium, badges and certificates. Teachers control leaderboard visibility and whether names are shown. |
| **Live** | Live, student-paced and front-of-class delivery. Includes the live response panel, raise-hand queue, announcements, 1:1 and group chat, screen sharing and whiteboard annotation. |
| **Guard** | Screen wall, spotlight, allow and block lists, category rules, open/close/redirect/focus/lock commands, environment-leave alerts with grace periods and deduplication, and off-task alerts with confidence scores. |
| **Insights** | Learning analytics and focus signals, reported separately. Includes session reports and CSV export. |
| **Admin** | Onboarding checklist, invites, CSV rosters, roles, privacy and retention settings, audit log, feature flags, plans and billing. Parents get a portal of summaries. |

## Quick start

```bash
npm ci
cp .env.example .env.local        # fill in your Supabase URL + keys
npx supabase link --project-ref <ref>
npx supabase db push              # applies supabase/migrations/*
npm run dev                       # http://localhost:3000
node scripts/smoke.mjs            # end-to-end check against your project
```

Then open `/signup` to create a school. Load `extension/` unpacked in Chrome (`chrome://extensions`, Developer mode) to try device monitoring. Full instructions are in [docs/SETUP.md](docs/SETUP.md). To deploy to production, follow [docs/DEPLOY.md](docs/DEPLOY.md). The compliance pack (DPIA, records of processing, incident response) is in [docs/compliance](docs/compliance/README.md).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js app |
| `npm run lint` / `type-check` | ESLint (Next.js + TypeScript rules) and TypeScript |
| `npm test` | Database suite and unit tests |
| `npm run test:db` | Database suite only: applies every migration to an in-process Postgres (PGlite) with a Supabase shim, then runs 16 end-to-end groups covering RLS isolation, grading, games, the policy engine, the device agent, WebRTC, privacy, the super admin, branding, the web classroom lockdown, operations and more |
| `npm run build:e2e` then `npm run test:e2e` | Playwright browser tests: public pages, security headers, the code sandbox, and (with a service-role key) the full live classroom: screen strip, teacher-only focus, leave alert and return |
| `npm run build:sql` | Regenerates `supabase/setup.sql` and the latest `supabase/updates` file from the migrations |
| `node scripts/smoke.mjs` | Same core flows against a real Supabase project, then cleans up |
| `node scripts/make-icons.mjs` | Regenerates the extension icons |

## How it's built

- **Tenant isolation in the database.** Every tenant row has a `tenant_id`, and child rows use composite `(id, tenant_id)` foreign keys, so no row can point at another school's data. Row-level security is on for every table and goes through `SECURITY DEFINER` helpers (`app.tenant_id()`, `app.can_manage_class()`, …).
- **Invariants live in RPCs.** Grading, games, sessions, commands, pairing and retention are Postgres functions with an empty `search_path`. The web app, the REST API and the extension all call the same functions.
- **The extension has no user session.** It pairs using a one-time code and receives a per-device secret, which the database stores only as a SHA-256 hash. Outside a live class it sends nothing about browsing.
- **Policy is evaluated on the server** with a deterministic engine (§14): domain matching respects label boundaries, and grace periods, deduplication and "student returned" are all handled server-side. A lost connection is shown as *connection lost*, never as a violation.

See [docs/ROLES.md](docs/ROLES.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/API.md](docs/API.md), [docs/BLUEPRINT_COVERAGE.md](docs/BLUEPRINT_COVERAGE.md) (including what is *not* built yet) and [SECURITY.md](SECURITY.md).

## Product boundaries

SwiftCipher monitors **school-managed browsers only**, and **only during live class sessions**. It never stores continuous screen recordings. Its alerts are prompts for teachers, and it never makes disciplinary decisions. It is an original design and does not copy any other vendor's code, UI or content.
