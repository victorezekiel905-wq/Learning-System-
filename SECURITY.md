# Security policy

## Reporting a vulnerability

Please email the security contact shown on the deployment's **/security** page (the address configured as `NEXT_PUBLIC_SUPPORT_EMAIL`) with the subject "Security". Do not open a public issue. We acknowledge reports within two working days.

## Model in brief

- **Tenancy.** Every tenant row carries `tenant_id`, and composite foreign keys stop cross-tenant references. RLS is enabled on every table. The `anon` role has no table access; it can only call the device-agent RPCs.
- **Authorisation.** RLS helpers and RPCs run as `SECURITY DEFINER` with an empty `search_path`. Clients cannot change their own role, tenant, status or email.
- **Answer keys.** `questions.answer_key` and `question_options.is_correct` are readable by staff only. Students receive sanitised copies and are graded on the server.
- **Device agent.** Devices pair with one-time codes. Each device has a 256-bit secret stored as SHA-256; the hash can't be selected even by admins. Devices can be disabled remotely. Telemetry is accepted only while a live session exists for that student.
- **Service role.** Only the server uses it: for auth-account deletion, emailing invites, storing reports and the billing webhook, and only after the caller has been authorised through RLS-bound RPCs.
- **Audit.** Screen access, spotlight, device commands, policy, scene and settings changes, roster changes, grades, invites and privacy exports and deletions are all recorded in `audit_logs`, which only admins can read.
- **Web.** The app sends CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy` and `Permissions-Policy` headers. Redirects are restricted to same-origin paths. CSV exports are escaped against formula injection. Rendered content is sanitised: slide text goes through a React-only formatter with no HTML injection, and embeds are https-only and sandboxed.
- **Student code.** JavaScript and Python exercises run in dedicated Web Workers served from `/sandbox/*` with their own CSP (`connect-src` limited to the pinned Pyodide CDN), so student code cannot call the app API with a viewer's session. Workers are terminated on timeout. The app CSP has no `unsafe-eval` in production.
- **Monitoring.** Browser and server errors go to `error_events` (no RLS read access; super admin only via `sa_errors`). `/api/health` checks database reachability for uptime monitors.
- **Classroom screens.** Screen frames are shared only after the browser's own consent prompt, are visible only to the class's teachers and school admins, and live frames are deleted by trigger when the session ends.
- **Tests.** `npm run test:db` asserts isolation, privilege and IDOR properties against the real migrations. `npm run test:e2e` (Playwright) checks headers, the code sandbox and the live classroom in a real browser.
