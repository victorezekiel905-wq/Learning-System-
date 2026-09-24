# Scaling to 5,000,000 users and 50,000 schools

This document covers the capacity model, what is built and tested, what each growth stage needs, and the levers you can pull under load.

**Planning assumption:** schools in one time zone, so school hours overlap. At peak, **20% of all users are in a live class at once**: 1,000,000 students and about 33,000 teachers. Treat this as a worst case. Measure your real peak with the load test and `/super`.

## 1. What each user costs

Live classes are the only heavy path. Everything else is ordinary page loads.

| Per student in a live class | Before (v1) | Now (migration 0760) |
|---|---|---|
| Database requests | ~0.6 /s (state poll 8 s, heartbeat 15 s, report 5 s, frame upload 5 s) | **~0.13 /s** (one tick per 10 s, plus a refetch only when the teacher changes something) |
| Database writes | ~0.4 /s, including ~0.2 /s of 20–40 KB screen images | **≤ 0.07 /s**, presence only; screen images: **none** |
| Realtime | postgres_changes on 4 tables (every change checked against every subscriber) | 1 socket, 2 private channels; tiny "changed" signals |
| Live screen frames | stored in Postgres | streamed on the student's private channel, **only while a teacher is watching** (school interval, default 10 s) |

Per teacher in a live room: roughly 0.1–0.3 requests a second (15 s poll plus pushed refreshes, at most one every 1.5 s), and one channel per joined student.

**At the 1,000,000-student peak:**

| | 10 s tick (default) | 30 s tick (load-shedding) |
|---|---|---|
| Database requests | ~135,000 /s | ~50,000 /s |
| Database writes | ~70,000 /s | ~25,000 /s |
| Realtime connections | ~1,030,000 | same |
| Screen frame messages (10 s interval) | ~100,000 /s | ~100,000 /s (the school interval controls this, not the tick) |

A single Postgres primary on the largest compute handles tens of thousands of simple writes a second, not hundreds of thousands. So the full 5M peak needs the **cell** architecture in §3, Stage 3. That is how every multi-tenant SaaS of this size runs. Up to Stage 2, one database is enough.

## 2. Built and verified

Each item below is enforced by tests that run in CI on every push.

- **Every foreign key and every `tenant_id` is indexed.** 143 were missing. A test now fails the build if any foreign key lacks an index (`supabase/tests/db.test.mjs`, "scale").
- **Query plans at volume.** `supabase/tests/scale.test.mjs` seeds 2,000 schools and 120,000 users and asserts that school lists, the super-admin console and retention use indexes (no full-table scans). Measured in-process:
  - student tick: about 3 ms;
  - teacher live-room refresh: about 6 ms.
- **Push instead of poll.** The database sends signals on private channels (`session:`, `staff:`, `user:`, `thread:`, `board:`, `game:`). Nothing uses postgres_changes, and the publication is empty (tested).
- **Channel security.** `app.can_listen` and `app.can_send`:
  - students can't watch screens or read the teacher's channel;
  - a student can only send frames as themselves, only while the class is live;
  - other schools can't join (tested).
- **Unchanged ticks write nothing and send nothing** (tested). Presence is refreshed at most every 1.5 ticks.
- **Retention runs set-based** across all schools, with one index probe per school per table and a time limit per run.
- **Platform console:**
  - keyset pagination (page 10,000 costs the same as page 1);
  - trigram search on names and emails;
  - overview totals cached hourly.
- **School admin "People":** server-side search and paging, 100 per page. The parent-invite picker is type-to-search.
- **Lower polling on games:** 10 s safety-net polls. Phase changes are pushed.
- **Upgrade path:** the update file is tested against a copy of today's production schema with data (`supabase/tests/upgrade.test.mjs`).

## 3. What each stage needs

| Stage | Users / schools | Peak live students | Database | Realtime | App |
|---|---|---|---|---|---|
| **1. Launch** | up to 50k / 500 | up to 10k | Supabase Pro, Medium–Large compute, PITR | Pro, plus the connection add-on as needed | Vercel Pro |
| **2. Growth** | up to 500k / 5,000 | up to 100k | Supabase Team or Enterprise, 4XL–16XL compute, a read replica for reports | Enterprise quotas (100k+ connections) | Vercel Enterprise or autoscaled containers |
| **3. National** | 5M / 50,000 | up to 1M | **Cells:** about 10 Supabase projects of ≤ 5,000 schools each, plus a small directory mapping each school to its cell | Per cell, as in Stage 2 | Same app deployed once, routing by the school's cell |

Supabase's prices and quotas change, so confirm current figures with Supabase before each stage. At Stage 2 and above, talk to their Enterprise team: Realtime connection and message quotas are raised by agreement.

### Cells (Stage 3)

Schools never share rows: every table is keyed by `tenant_id`, and nothing joins across schools except the super-admin console. So the database can be split by school with no schema change:

- a **directory** (one small database) maps each `tenant_id` to its cell's Supabase URL and keys;
- sign-in resolves the user's cell once and stores it in a cookie;
- the app then talks only to that cell;
- the super-admin console reads each cell and merges the results.

This is not built yet. Build it when monitoring shows one database passing about 60% of its CPU at peak. `docs/DEPLOY.md` covers one cell. Each further cell is the same setup, repeated.

### Screen frames at national scale

At 100,000 frames a second, per-message Realtime pricing becomes the largest cost. Before Stage 3, either:
- negotiate Realtime pricing; or
- move frames to a self-hosted media server (for example LiveKit), where each student publishes a low-frame-rate screen track.

The swap is isolated to two files: `src/lib/classroom-guard.ts` (`sendLive`) and `src/lib/screen-feed.ts`.

### Very large tables

Retention keeps tables bounded: telemetry for 30 days and learning records for 730 days by default. At Stage 3, partition `quiz_answers`, `quiz_attempts`, `audit_logs` and `notifications` by month, so retention drops whole partitions instead of deleting rows.

## 4. Levers under load (no deploy needed)

| Lever | How | Effect |
|---|---|---|
| Student tick interval | `update public.platform_config set value = '30' where key = 'student_tick_seconds';` (5–60 s) | Database requests and writes from live classes fall roughly 3×. Presence and leave detection widen automatically (3 ticks + 15 s). |
| Screen thumbnail interval | Admin → Settings → screen thumbnails, per school (new schools start at 10 s; schools created before 2026-09-24 keep 20 s) | Realtime frame messages fall proportionally. |
| Screen capture off | Admin → Settings, per school | No frames at all. Lockdown and leave alerts still work. |
| Lockdown off | The teacher's live-room button | No leave tracking for that class. |

## 5. Load testing before each stage

Use a **staging** project on the same plan and compute as production:

```
node scripts/load/classroom-load.mjs --students 1000 --class-size 30 --minutes 10 --frames
```

Run it from a machine close to the database (for example a cloud VM in Ireland). From a distant or busy connection the numbers mostly measure that connection: from an office PC in Nigeria, a bare round trip took 300–400 ms, while the database itself answers each classroom call in milliseconds.

It creates a throwaway school, simulates exactly what the pages do, prints request rates and p50/p95/p99 latency per call, then deletes everything. For bigger numbers, run several copies from different machines.

**Pass criteria:**
- p95 `student_report` under 150 ms;
- p95 `teacher_session_state` under 400 ms;
- errors under 0.1%;
- database CPU under 60% (Supabase → Reports).

Watch `/super/errors` during the run.
