# Blueprint coverage

This is a section-by-section map of the *EduClass Fusion Blueprint v1.0* to this codebase.
✅ built · 🟡 partial (limits stated) · ⏳ not built (Phase 3 or needs external services)

## §3.1 Lesson Studio
- ✅ Rich slides: title, text, image, video, audio, embed, link, attachment, shapes, whiteboard, activity (`teacher/lessons/[id]`)
- 🟡 Import of PPTX/PDF/DOCX/MD/TXT into editable slides. Only text is extracted; images inside decks are not.
- ✅ Interactive video with timestamped questions. Pauses and seek-guards on uploaded/mp4 video; a checkpoint list for YouTube/Vimeo.
- ✅ Teacher whiteboard: whiteboard slides plus live annotation over a private realtime channel
- ✅ Templates, duplication, versioning (immutable snapshot per publish), draft/published
- ✅ Media library: upload with image compression, folders, tags, full-text search
- 🟡 Accessibility: keyboard navigation, alt-text prompts, captions (VTT), contrast. No formal audit yet.
- ✅ Live, student-paced and front-of-class (`/present`) modes; share links with expiry, class restriction and revocation

## §3.2 Activity / Assessment
- ✅ Multiple choice, open-ended, poll, quiz, draw, fill-in-the-blank, matching, drag and drop (order and categorise), collaboration board, file submission, rubric-graded short answer
- ✅ Coding activity for JS, HTML/CSS and Python. Code runs sandboxed in the browser (opaque iframe; Pyodide in a killable worker). Test results are advisory and the teacher gives the mark.
- ✅ Question bank, per-attempt seeded randomisation, answer shuffling, attempts, time limits, feedback modes, auto-marking, review queue

## §3.3 Game engine
- ✅ Lobby and join code, teacher nickname rules and moderation, points, speed bonus with anti-lag normalisation, streaks, timers, live leaderboard, podium, own-rank visibility, hidden, anonymous and public modes, teams, per-round review, badges and certificates, answer-window lock, question randomisation, suspicious-pattern log

## §3.4 Live classroom
- ✅ Session join code, presence (online/idle/offline), per-student progress, live responses, raise-hand, announcements, private 1:1 chat, policy-gated group chat
- ✅ Teacher screen sharing and camera over WebRTC (star topology); screen wall with a configurable refresh rate; spotlight; logged
- 🟡 Group audio/video conferencing: one-to-many only; an SFU is needed for many-to-many (see SETUP §7)
- 🟡 Multi-screen showcase: one spotlight at a time, plus enlarging any tile

## §3.5–3.8 Guard
- ✅ Device registration, connection status, thumbnails, active URL, tab count, last seen, minimal device metadata, allow/block lists, open/close/redirect/focus/lock/unlock/close-others/message commands, scenes, student groups with auto-start environments, diagnostics, session history, command audit trail
- ✅ Environments: grace period, deduplication, idle and connection-loss events, severities, "student returned", student-facing notice, full event record
- ✅ Spotlight with notice to the student, anonymised mode, school-level switch, logging
- ✅ Rule-based off-task detection with a confidence score; dismiss, confirm and mute; feedback lowers frequency; no automatic discipline
- ⏳ ML off-task classification (Phase 3, gated on privacy and bias testing)
- ⏳ Auto-blur or redaction before spotlight (flagged in the blueprint as a later version)

## §4 Roles & permissions
- ✅ Student, teacher, school admin, IT admin and parent, with RLS plus RPC checks and tenant isolation
- 🟡 Platform admin: the role and the support-access window exist, but there is no cross-tenant operator console

## §5–§9 Architecture, stack, data model, realtime
- ✅ Next.js + TypeScript + Tailwind; Supabase Postgres, Auth, Realtime and Storage; Chrome/Edge extension first
- ✅ Every table in §7 exists (`quizzes` and `student_presence` are views)
- ✅ Realtime events are delivered as row changes on the tables the event model names, plus a private broadcast channel
- ⏳ Redis/BullMQ, OpenTelemetry, OpenSearch: not needed at this scale; Postgres covers queueing and search

## §10 API
- ✅ All listed endpoints under `/api/v1`, plus the device gateway (docs/API.md)

## §11–§13 UX & leaderboard
- ✅ Teacher dashboard with the left-hand navigation, a live classroom with the Lesson, Responses, Screens, Environment and Chat tabs, the screen wall and the command bar
- ✅ Student dashboard covering every §12 item
- ✅ Leaderboard rules: correctness first, then speed; speed optional; first name + last initial by default; nickname mode; own position always visible; can be switched off

## §14–§17 Policy engine, screens, presence, notifications
- ✅ Deterministic server evaluation; fails safe
- ✅ Low-resolution thumbnails; on-demand high quality for spotlight; no stored recordings; event screenshots opt-in; per-frame authorisation; rate-limited
- ✅ Notifications: student joined, returned, left environment, off-task, help request, new assignment submitted, game created, announcement, grade released, chat
- 🟡 Email alerts: the setting exists, but no mail sender is wired up (it needs an SMTP or email API); browser notifications and sound work
- 🟡 "Student disconnected" appears as a connection-loss alert and presence; "Device enrolment failure" and "policy conflict" surface as errors, not as notifications

## §18 Analytics
- ✅ Participation, accuracy, difficulty, response time, score distribution, leaderboard history, leave/off-task rates, connectivity, assignment completion, interventions, school weekly trends; learning and telemetry kept separate, each with its own retention

## §19 School administration
- ✅ Onboarding checklist, CSV roster import, invites, role and status management, device enrolment, environment and scene templates, moderation settings, retention, audit log viewer, CSV report export, plans and billing, feature flags, support-access window
- 🟡 SSO: Google and Microsoft through Supabase OAuth; ⏳ ClassLink-style roster sync (a later phase in the blueprint)

## §20 Privacy & security
- ✅ Tenant isolation (database and API), RBAC, refresh-token rotation (Supabase), TLS (host), audit logs, configurable retention with nightly purge (pg_cron), continuous recording off, consent and notice workflow (versioned, re-acknowledged on change), student and teacher notices, data export and deletion, security headers and CSP, input validation, rate limiting, secrets only on the server, dependency audit in CI
- ⏳ A managed secret vault, container scanning, and backup/restore drills are operational tasks for your host

## §21 Extension
- ✅ Secure enrolment, session binding, heartbeat, tab/domain reporting, connection status, screen capture, all commands with acknowledgement, policy updates, automatic reconnect, version reporting, remote disable/unenrol, secret-based authentication, admin-pushed configuration

## §22–§24 Phases
- ✅ The whole §22 MVP list
- ✅ Phase 2 (§23) apart from the partial items above
- ⏳ Phase 3 (§24): AI generation and feedback, ML off-task classification, OS and mobile management integrations, predictive analytics

## §25–§26 Plans & billing metrics
- ✅ Five plans with limits enforced in RPCs (classes, students per class, teachers, managed devices); a usage page covering every §26 metric; Stripe checkout and verified webhook
- 🟡 AI credits are not tracked (no AI features); local payment providers (§32) need an adapter

## §29 Testing
- ✅ Unit and integration tests for policy evaluation, scoring and permissions; multi-tenant isolation; IDOR and privilege checks (see `supabase/tests`)
- ⏳ Load tests (100+ clients) and browser-extension compatibility tests need infrastructure beyond CI

## §33 Low bandwidth
- ✅ Compressed images, local answer queue with sync, low-resolution thumbnails, video off by default on poor connections, text-first chat, bandwidth indicator, automatic polling back-off
- ⏳ Offline lesson cache (service worker) is not built
