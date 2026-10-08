# Live engine: plan (approved 2026-10-07)

SwiftCipher becomes a **live, teacher-paced presentation and engagement engine**
(Nearpod + Pear Deck + Kahoot). This document proposes the data model, the session
state machine, and the realtime contract. Approved 2026-10-07 (6-character join codes shown as `DV6-44Y`; speed bonus up to +50%).

Decisions already taken (2026-10-07):

- **Stack:** keep Next.js 16 + Supabase (Postgres with row-level security, Realtime,
  Storage). Database functions are the server-side source of truth; Supabase Realtime
  pushes changes. No NestJS, Prisma, Socket.IO or Redis.
- **Monitoring** (lockdown, screen strip, leave alerts, blocked sites, device extension):
  an **optional add-on**, off by default per school. The engine never depends on it.
- **Messaging and the parent portal:** hidden until Phase 3; code and data kept.
- **Assignment pipeline** (assignments, submissions, rubrics, marking queue, grades,
  gradebook, "My work", attendance): **retired**. Screens, menu items and routes go;
  tables stay until a separate clean-up migration is approved.

---

## 1. Data model

Existing tables are reused where they already fit; names in the UI change, table names
stay (renaming tables would break every policy and test for no user benefit).

| Brief entity | Table | Change |
|---|---|---|
| School | `tenants` | none |
| User | `users` | none (roles from the database row, never from the client) |
| Class / Group | `classes`, `class_members` | **optional** for a session (`class_sessions.class_id` becomes nullable) |
| **Deck** | `lessons` | add `visibility` (`private` / `school` / `public`), `tags text[]`; UI says "Deck" |
| **Slide** | `lesson_slides` | `kind` comes from a **slide-type registry** (§4); new kinds `word_cloud`, `leaderboard`, `team_score` |
| Resource | `lesson_media` + slide `attachment` | add `downloadable boolean` per slide resource |
| **Session** | `class_sessions` | add `phase` (§2), `settings jsonb`, `activity_state`, `activity_opened_at`, `activity_closes_at`, `paused`, `show_leaderboard`, `revealed` |
| **Participant** | `session_participants` | add `display_name`, `avatar`, `total_score`, `streak`, `correct_count`, `team_id`, `removed_at` |
| Session pass | `session_guests` → **`session_passes`** | any participant who joined by code (guest **or** signed-in student without a class) |
| **Response** | `quiz_attempts` + `quiz_answers` | add `points int`, `response_ms int` (server-timed), `scored_at` |
| Team | **new** `session_teams` | `session_id, name, colour, captain_user_id` |
| Badge | **new** `session_badges` | `session_id, user_id, badge, awarded_at` (First Correct, Streak ×3, Fastest Finger, Perfect Round, Most Improved) |
| SessionReport | `reports` (`session_summary`) | payload gains per-question accuracy and per-participant scores |

`settings` (per session):
`{ leaderboard: true, anonymous_names: false, late_join: true, lock_navigation: true,
   speed_bonus: true, teams: false, time_limit_seconds: null, allow_change_until_closed: false }`

**Why answers stay in `quiz_answers`:** all 12 existing activity players, the offline
queue and the reports already use `start_attempt` / `submit_answer`. Scoring is added
inside `submit_answer`, so no activity UI is rewritten.

---

## 2. Session state machine

```
            start                     end (from any state)
  LOBBY ───────────▶ ACTIVE ◀──────▶ PAUSED ───────────▶ ENDED
    ▲                  │   pause/resume                       ▲
    └── (created)      └───────────────── end ────────────────┘
```

| Phase | Students see | Allowed teacher events |
|---|---|---|
| `lobby` | "Waiting for your teacher…", own name and avatar, participant count | `start`, `end`, `kick`, settings |
| `active` | the current slide (LIVE) or their own slide (STUDENT_PACED) | `next`, `prev`, `goto(n)`, `open`, `close`, `reveal`, `timer(s)`, `leaderboard(on/off)`, `pause`, `kick`, `end` |
| `paused` | "Eyes on your teacher" (screens locked) | `resume`, `end`, `kick` |
| `ended` | final score, rank, badges | none (report available) |

**Activity sub-state** on the current slide: `idle → open → closed → revealed`.

- `open` sets `activity_opened_at` (server time) and an optional `activity_closes_at`.
- Moving to another slide closes an open activity automatically.
- Answers are accepted only while `open`, and only before `closes_at` plus 1 s of grace.
- `reveal` publishes the correct answer and the distribution, and sends each
  participant their points.

**Modes:** `LIVE` (navigation locked to the teacher) and `STUDENT_PACED` (each
participant moves on their own; activities are always open; no speed bonus).

All teacher events go through **one** database function,
`session_control(p_session, p_action, p_args jsonb)`. It checks that the caller manages
the session, checks the transition is valid for the current phase, writes the new
state, increments `state_version`, and broadcasts (§3) in the same transaction.

---

## 3. Realtime contract (Supabase Realtime, private channels)

Channels are authorised by the database (`app.can_listen`): only people in the session
can listen; only the server (database functions) sends lesson events.

| Channel | Event | Payload (compact) | Sent when |
|---|---|---|---|
| `session:<id>` | `state` | `{v, phase, mode, slide, activity:{id,state,opened_at,closes_at} \| null, paused, leaderboard, server_now}` | every teacher event |
| `session:<id>` | `leaderboard` | `{top:[{name,avatar,score,rank,delta}] (top 5–10), teams?:[…]}` | `leaderboard on`, after `reveal` |
| `session:<id>` | `reveal` | `{activity_id, correct, distribution}` | `reveal` |
| `user:<uid>` | `score` | `{points, total, rank, streak, correct, badges[]}` | after `reveal` (private: own rank only) |
| `staff:<id>` | `responses` | `{activity_id, answered, total, distribution}` | each answer (throttled to 4/s) |
| `staff:<id>` | `participants` | `{online, total, joined[], left[]}` | join / leave / kick |

Clients apply `state` payloads directly, without refetching, so a slide change is one
database write plus one broadcast. On reconnect a client calls
`session_student_state` once and continues. The Supabase sign-in (a guest's anonymous
sign-in included) is kept in the browser, so a refresh resumes as the same participant
with the same score.

Calls from the student are database functions (never trusted for time or role):
`join_session` / `join_session_as_guest`, `set_avatar`, `start_attempt`,
`submit_answer` (server-timed and scored), `student_report` (presence).

---

## 4. Slide-type registry

`src/slides/registry.ts` maps each type to:
`{ label, group, editor, student, teacherLive, results, schema, scoring? }`.
The session engine only knows "content slide" vs "activity slide"; adding a type never
touches it.

Phase 1 types: `title`, `text` (with image), `image`, `mcq` (single/multi),
`true_false`, `poll`, `open_ended`, `leaderboard`.
Phase 2: `video` (synced), `embed`, `resource`, `short_answer`, `word_cloud`, `draw`,
`matching`, `ordering`, `fill_blank`, `team_score`.

---

## 5. Scoring (server-side, in `submit_answer`)

- Correct: `base = 1000 × question weight`.
- Speed bonus (if on): `base × 0.5 × (1 − elapsed / window)`, where elapsed is
  `submitted_at − activity_opened_at` (server clock) and the window is the timer, or
  20 s if none.
- Streak: +100 per consecutive correct answer, up to +500.
- Polls, open-ended and word cloud: 100 participation points.
- Totals live on `session_participants`, updated under a row lock, so concurrent
  answers can't double-count. Rank is computed from totals. Bottom ranks are never shown.

---

## 6. Phase 1 increments (each ends with what to run to see it)

0. ✅ **Retire and hide** (done 2026-10-07): the assignment pipeline; menus for messaging and the parent
   portal; monitoring behind a per-school switch (off by default for new schools, migration 0870).
1. ✅ **Engine core** (done 2026-10-07, migration 0880): phases, `session_control`, `state` broadcasts with the compact state, lobby with avatars, pause, end screens, classless sessions, join by code for students.
2. ✅ **Scoring** (done 2026-10-07, migration 0890): server-side points (correct, speed, streak, participation), the frozen leaderboard snapshot with rank movement, the points line after each answer, own rank privately, final score.
3. ✅ **Teacher control panel** (done 2026-10-08, migration 0900): keyboard shortcuts (→ ← L R P S), reveal, live answered counts, QR code, projector results and leaderboard, game settings at the start.
4. **Deck builder:** the slide-type registry, slide sorter, canvas, properties panel.
5. **Report and proof:** per-question accuracy and per-participant scores;
   cross-school isolation tests; a 30-browser latency test against the 300 ms target.
