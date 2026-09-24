# Records of processing activities

Kept under NDPA 2023 and GDPR Art. 30(2), with SwiftCipher acting as **processor** for schools. Review every 12 months and whenever a feature changes what data is processed.

| # | Activity | Controller | Data subjects | Personal data | Purpose | Retention | Sub-processors | Transfers |
|---|---|---|---|---|---|---|---|---|
| 1 | Accounts and rosters | School | Students, staff, parents | Name, email, role, class membership, nickname | Provide access to the school's workspace | Until deleted by school or user | Supabase, SMTP provider | Supabase region; SMTP provider |
| 2 | Teaching and assessment | School | Students, teachers | Answers, attempts, scores, submissions, grades, feedback, games | Deliver lessons, grading and reports | School setting (default 730 days) | Supabase | Supabase region |
| 3 | Live classes | School | Students, teachers | Presence, focus signals, chat, raised hands, attendance | Run live lessons | Attendance per learning retention; chat per learning retention | Supabase | Supabase region |
| 4 | Classroom monitoring (web) | School | Students | Screen frames (only while sharing in a live class), focus and full-screen state, leave alerts, optional alert screenshot | Keep students on task during live classes | Frames: until the class ends. Alerts and screenshots: telemetry retention (default 30 days) | Supabase | Supabase region |
| 5 | Classroom monitoring (managed browser) | School | Students | Active URL and title, tab count, idle state, screen frames, device commands | Enforce the school's browsing policy during class | Telemetry retention (default 30 days) | Supabase | Supabase region |
| 6 | Messaging and notifications | School | All users | Messages, announcements, notification content | Communication in class | Messages per learning retention; notifications 90 days | Supabase, SMTP provider | As above |
| 7 | Parent portal | School | Parents, students | Summaries of the linked child's progress | Inform parents | Derived; no separate copy | Supabase | Supabase region |
| 8 | Billing *(SwiftCipher as controller)* | SwiftCipher | School billing contacts | Name, email, plan, invoices | Charge for subscriptions | As required by tax law | Stripe | United States / EU |
| 9 | Security and operations *(SwiftCipher as controller)* | SwiftCipher | All users | Error reports (page, browser, technical message), audit logs, auth logs | Security, troubleshooting | Errors 30 days; audit for the life of the workspace | Supabase, Vercel | Supabase region; Vercel edge |

**Security measures:** see `/dpa` §6 and `SECURITY.md`.
