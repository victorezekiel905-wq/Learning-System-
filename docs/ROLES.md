# Roles and privileges

Each role's permissions are enforced by the database (row-level security and RPC checks), not only by the UI. Every role except the super admin is limited to its own school (tenant). No school can see another school.

| Role | Obtained by | Can |
|---|---|---|
| **Super admin** (platform) | Assigned once with `scripts/set-super-admin.mjs`. There can only be one, and no in-app action can grant it. | Everything in `/super`: create, rename, re-plan, suspend, restore and delete any school; change the role of, suspend, lift the suspension of, or delete any user; invite school staff; read the platform audit log. It is invisible to everyone else: `/super` returns a 404 for other users, and schools see these actions in their audit log as `platform.*` without the operator's identity. |
| **School admin** | Creating a school, or an admin invite | Everything in their school: people, roles, invites, classes, settings, privacy and retention, **branding** (name, logo, colours, welcome message), audit log, billing |
| **Teacher** | Invite from an admin | Their own classes and co-taught classes, lessons, activities, live sessions (screens, commands, alerts, spotlight), grading, games, and analytics for their classes |
| **IT admin** | Invite from an admin | All of the school's devices (pairing, disabling, unenrolling, diagnostics) and environments. No access to academic content. |
| **Student** | Class code or student invite | Joining classes, sessions and games; answering; seeing their own work, grades and device data; messaging their teachers |
| **Parent** | Parent invite linked to one student | Summaries for that child only, and only when the school enables the parent portal |

When a school is **suspended**, all of its users and devices are locked out until the super admin restores it. Live sessions end straight away.

## Classroom screens

During a live session, the teacher's screen has a **left-hand strip** with every student who has joined.

- A tile turns red and shows **LEFT CLASS** when the student leaves the allowed sites, after the grace period.
- Clicking a tile opens that student's screen **large, for the teacher only**. **Minimize** returns to the lesson. Students' screens don't change, and they keep seeing the teacher's lesson.
- Showing a student's screen *to the class* is a separate, deliberate action (**Spotlight**), and the student is always told when it happens.
- Screen images need the SwiftCipher browser extension on a school-managed browser. A website can't see anyone's screen on its own.
