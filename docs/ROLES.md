# Roles, privileges and isolation

Who can do what in SwiftCipher, how schools are kept apart, and how to get platform
(super admin) access. Every rule here is enforced **by the database** (row-level security
and permission checks inside every function), not only by hiding buttons, and is covered
by automated tests (`npm test`) and the penetration test (`scripts/pentest.mts`).

## 1. Getting super admin access

There is exactly **one** super admin for the whole platform. No button in the app can
grant it: only someone who controls the Supabase project can.

1. **Create the account.** Supabase dashboard → *Authentication* → *Users* → *Add user* →
   *Create new user*. Use a dedicated address (e.g. `Admin@synergyswift.com`), tick
   *Auto Confirm User*, set a strong password. Don't create a school with this account;
   the super admin doesn't need one.
2. **Grant the role.** Open `supabase/scripts/make_super_admin.sql`, change the email on the
   marked line, then Supabase → *SQL Editor* → *New query* → paste → *Run*. The result
   shows the email that now holds the role.
   (Alternative from a computer with `.env.local`: `node scripts/set-super-admin.mjs you@example.com`.)
3. **Sign in** at `/login` with that account. You land on **`/super`**.

To hand the role to someone else, run the script again with their email. The previous
account loses it in the same step. Every assignment is recorded in the platform audit log.
Anyone else who opens `/super` gets "page not found": the area doesn't reveal it exists.

**Protect this account:** use a password manager, turn on multi-factor authentication in
Supabase Auth, and never use it for day-to-day school work.

## 2. Roles and what each can do

| Role | How someone gets it | Can | Cannot |
|---|---|---|---|
| **Super admin** (platform) | The script above; only one exists | Create, rename, change plan, suspend, restore and delete **any school**; change the role of, suspend, restore or delete **any user**; invite a school's first admin; read the platform audit log and error log; see each school's settings, user list (names, emails, roles), usage counts and staff invites | Read lessons, answers, grades, messages, screens or focus events inside a school: the platform operator manages accounts, not children's learning data. Invisible to schools, which see platform actions in their audit log as `platform.*` without the operator's identity |
| **School admin** | Creating a school, or an admin invite | Everything in **their** school: people, roles, invites, classes, settings (privacy, retention, lockdown defaults, parent portal, how much focus detail parents see), branding, audit log, billing, all reports | Anything in another school. Unlock features their plan doesn't include (blocked since the 2026-09-27 penetration test) |
| **Teacher** | Invite from an admin | Their own and co-taught classes: lessons, activities, question bank, live lessons (student screens, lockdown, commands, alerts, spotlight), games, marking, gradebook export, learning supports, student-written questions, reports and parent reports for their students, messages with their students and those students' parents | See classes they don't teach, other teachers' private messages, or other schools |
| **IT admin** | Invite from an admin | All of the school's devices (pairing, disabling, unenrolling, diagnostics), environments (allowed and blocked sites, anti-gaming lists), class lists and reports | Academic content: lessons, answers, grades |
| **Student** | A class code or a student invite | Join their classes, live lessons and games; answer; choose their challenge level (if allowed); write questions for approval; see their own work, grades, XP, badges and supports; message their teachers | See other students' work, supports, reports or messages; see the conversations between their parents and teachers; change their role, their settings or their XP; join a class without its code (wrong codes are limited to 8 per 15 minutes) |
| **Parent / guardian** | A parent invite linked to one child (a child can have several guardians, each with their own account) | Only while the school has the parent portal on, and only for **their own linked children**: daily and weekly reports per subject (attendance, time in class, participation, accuracy, reasoning, XP, badges, homework, released grades, six-week progress), focus events (when the child left a lesson, what they were doing, where they went, how long; or only counts if the school chooses), their own alerts (left a lesson, low grade, weekly summary), private messages with their child's teachers, monitoring consent | See other children, class rosters, lessons, or screenshots (never shared with parents, because they can show other children) |

When a school is **suspended**, all of its users and devices are locked out until the super
admin restores it, and live lessons end straight away.

## 3. Tenant isolation (schools can't see each other)

Every school is a *tenant*. Separation is built in at several independent layers, so a
mistake in one is caught by the next:

1. **Every row carries its school.** Each table holding school data has a `tenant_id`, and
   foreign keys pair it with the ID (`(user_id, tenant_id)`, `(class_id, tenant_id)`…). The
   database refuses a row that points at another school's user or class.
2. **Row-level security on every table.** Postgres filters every read and write to the
   signed-in user's school (`tenant_id = app.tenant_id()`) and then to what their role
   allows. Verified: all tables have it on, and six internal tables have no client access at all.
3. **Permission checks inside every function.** Every server function checks the caller
   (`can_manage_class`, `is_parent_of`, `teaches_student`…) before doing anything, runs
   with a pinned search path, and anonymous visitors can call only the device and health
   endpoints.
4. **Private realtime channels.** Live updates, screen frames and chat signals travel on
   channels the database authorises per user. A student can't listen to another
   student's screen, and a child can't listen to their parent's conversation with a teacher.
5. **Files are stored per school.** Uploaded files live under the school's own folder and
   the storage rules check it.
6. **Suspension and deletion are total.** A suspended school behaves as if no one is signed
   in. Deleting a school removes every row that belongs to it.

**Evidence (penetration test, 2026-09-27):** users of one school tried 186 ways to read
another school's data, and 16 actions against it (ending its lessons, reading its private
messages, exporting its students' data, editing its lessons…). **Every one was refused.**
Details: [security/PENTEST-2026-09-27.md](security/PENTEST-2026-09-27.md).

## 4. Privilege isolation (inside one school)

- **Roles live in the database**, on the user's row, and only admins (or the super admin)
  can change them. A student trying to make themselves admin is refused.
- **Staff areas check the role on the server.** Pages for teachers and admins check the
  role before loading anything, and the functions behind them check again.
- **Teachers are limited to their classes.** Co-teachers share a class; nobody sees
  classes they don't teach.
- **Private things stay private:**
  - student ↔ teacher and parent ↔ teacher messages are readable only by the two people involved;
  - learning supports and their staff notes are visible to staff only (the student sees their own supports, never the note);
  - screenshots are staff-only;
  - wrong join-code attempts are recorded but unreadable by anyone.
- **Scores can't be forged:** answers are marked on the server, a revealed answer can't
  be changed, games score on the server with anti-cheat checks, and only teachers can award XP.
- **Money is protected:** plan features come from the plan; a school can switch features
  off for itself but can't switch on features it hasn't paid for.

## 5. The live classroom (what teachers see)

- Every student who joins appears in the **left-hand strip**. A tile turns red
  (**LEFT LESSON** at once, **LEFT CLASS** after the grace period) when the student leaves.
  Students who close the lesson stay at the top of the strip until the teacher deals with it.
- Clicking a tile opens that student's screen **large, for the teacher only**. Students
  keep seeing the teacher's lesson.
- Showing a student's screen **to the class** (Spotlight) is a separate action, and the
  student is always told.
- Screens come from the student sharing their entire screen in the lesson page (Chrome and
  Edge on laptops) or from the SwiftCipher extension on school-managed Chromebooks. Phones
  and tablets can't share their screen from a browser; they're held to keeping the lesson open.
