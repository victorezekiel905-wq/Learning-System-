# Security policy

## Reporting a vulnerability

Please email **security@swiftcipher.app** with the details. Do not open a public issue. We aim to acknowledge reports within 3 business days.

## Model in brief

- **Tenancy.** Every tenant row carries `tenant_id`, and composite foreign keys stop cross-tenant references. RLS is enabled on every table. The `anon` role has no table access; it can only call the device-agent RPCs.
- **Authorisation.** RLS helpers and RPCs run as `SECURITY DEFINER` with an empty `search_path`. Clients cannot change their own role, tenant, status or email.
- **Answer keys.** `questions.answer_key` and `question_options.is_correct` are readable by staff only. Students receive sanitised copies and are graded on the server.
- **Device agent.** Devices pair with one-time codes. Each device has a 256-bit secret stored as SHA-256; the hash can't be selected even by admins. Devices can be disabled remotely. Telemetry is accepted only while a live session exists for that student.
- **Service role.** Only the server uses it: for auth-account deletion, emailing invites, storing reports and the billing webhook, and only after the caller has been authorised through RLS-bound RPCs.
- **Audit.** Screen access, spotlight, device commands, policy, scene and settings changes, roster changes, grades, invites and privacy exports and deletions are all recorded in `audit_logs`, which only admins can read.
- **Web.** The app sends CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy` and `Permissions-Policy` headers. Redirects are restricted to same-origin paths. CSV exports are escaped against formula injection. Rendered content is sanitised: slide text goes through a React-only formatter with no HTML injection, and embeds are https-only and sandboxed.
- **Tests.** `npm run test:db` asserts isolation, privilege and IDOR properties against the real migrations.
