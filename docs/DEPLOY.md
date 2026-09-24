# Going live

This is the production runbook: accounts, settings, the go-live checklist, and what to do when something goes wrong. For local development, see [SETUP.md](SETUP.md).

Recommended stack: **Vercel** (app) + **Supabase Pro** (database, auth, storage) + an **SMTP provider** (email) + **GitHub Actions** (CI, database deploys, maintenance, uptime checks).

---

## 1. Supabase (database)

1. **Upgrade the project to Pro.** Project → Settings → Billing. The free tier pauses inactive projects, has no backups, and caps realtime at about 200 connections, which is too few for several live classes.
2. **Backups.** Pro includes daily backups kept for 7 days. For schools, also turn on **Point-in-Time Recovery** (Settings → Add-ons) so you can restore to any minute.
3. **Apply the latest schema.** SQL Editor → New query → paste all of `supabase/updates/2026-09-24_production_release.sql` → Run. The last row should show `lockdown_ready`, `operations_ready` and `scale_ready` all `true`. It's safe to run twice.
4. **Realtime.** Project Settings → Realtime: turn **off** "Allow public access", so only private channels (checked by `app.can_listen` / `app.can_send`) can be joined. For large deployments, raise the connection and message quotas with Supabase (see [SCALING.md](SCALING.md)).
5. **Hourly maintenance.** Database → Extensions → enable **pg_cron**, then run the update file again once. It schedules `swiftcipher-maintenance` every hour. Check it with `select * from cron.job;`.
6. **Rotate the service-role key** if it has ever been pasted anywhere (chat, email, screenshots): Settings → API → JWT Settings → *Generate new secret*. Then update it in Vercel and GitHub (below).
7. **Auth → URL Configuration.** Set *Site URL* to your production URL, and add `https://YOUR-DOMAIN/**` to *Redirect URLs*.
8. **Auth → SMTP.** Turn on custom SMTP with your provider (Resend, SendGrid, Postmark, Amazon SES or Mailgun). The built-in sender only allows a few emails an hour.
9. **Auth → Email templates.** Use the token-hash links from [SETUP.md §1](SETUP.md), so confirmation links work in any browser.
10. **Auth → Rate limits / Attack protection.** Turn on CAPTCHA (hCaptcha or Turnstile) for sign-ups if your schools allow public registration, and keep the default sign-in rate limits.

## 2. Vercel (app)

1. Import the GitHub repository in Vercel (Framework: Next.js). Choose the same region as your Supabase project, e.g. `fra1` for Supabase `eu-central-1`.
2. **Environment variables** (Production). Every `NEXT_PUBLIC_*` value is built into the pages, so redeploy after changing one.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key (**rotated**) |
| `NEXT_PUBLIC_APP_URL` | `https://your-domain` |
| `NEXT_PUBLIC_LEGAL_ENTITY` | Registered company name, e.g. "SwiftCipher Technologies Ltd (RC 1234567)" |
| `NEXT_PUBLIC_LEGAL_ADDRESS` | Registered address |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Support/sales/security inbox |
| `NEXT_PUBLIC_PRIVACY_EMAIL` | Privacy / Data Protection Officer inbox |
| `NEXT_PUBLIC_HOSTING_REGION` | e.g. "EU (Frankfurt)", the Supabase region |
| `NEXT_PUBLIC_GOVERNING_LAW` | optional; default "the Federal Republic of Nigeria" |
| `NEXT_PUBLIC_SSO_PROVIDERS` | optional, e.g. `google,azure` (enable them in Supabase Auth first) |
| `STRIPE_*` | optional, for online payments ([SETUP.md §6](SETUP.md)) |
| `NEXT_PUBLIC_TURN_*` | optional, for strict school networks ([SETUP.md §7](SETUP.md)) |

3. **Domain.** Vercel → Domains → add your domain, then set the DNS records Vercel shows. HTTPS is automatic.
4. Deploy. Then open `https://your-domain/api/health`. It should return `{"ok":true,"db":"up","schema":"0760",...}`, and `missing_legal_details` should be `[]`.

Self-hosting instead? `docker build` with the same `NEXT_PUBLIC_*` values as `--build-arg`, then run the image with the server-only variables. The image has a health check built in.

## 3. GitHub (automation)

Repository → Settings → Secrets and variables → Actions:

| Name | Kind | Used by |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | secret | CI build, keep-alive |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | Maintenance (daily backup job for pg_cron) |
| `SUPABASE_ACCESS_TOKEN` | secret | Deploy database (supabase.com → Account → Access tokens) |
| `SUPABASE_DB_PASSWORD` | secret | Deploy database |
| `SUPABASE_PROJECT_REF` | secret | Deploy database (e.g. `wotevpwomibysehxfvdb`) |
| `E2E_SUPABASE_SERVICE_ROLE_KEY` | secret, optional | CI runs the live-classroom browser test (creates and deletes a test school) |
| `APP_URL` | **variable** | Uptime check every 15 minutes |

**One time only:** after step 1.3, open Actions → *Deploy database* → Run workflow with **baseline** ticked. This records the existing migrations as applied. From then on, every new file in `supabase/migrations` is applied automatically when it reaches `main`.

Create a GitHub **environment** called `production` (Settings → Environments). You can add yourself as a required reviewer so database changes wait for your approval.

Turn on email for failed workflows: GitHub → Settings → Notifications → Actions. A failed *Uptime* run means the site or database is down.

## 4. Go-live checklist

- [ ] Supabase Pro, PITR on, pg_cron scheduled (`select * from cron.job`), Realtime public access off
- [ ] Load test passed on staging at your expected peak ([SCALING.md §5](SCALING.md))
- [ ] `2026-09-24_production_release.sql` applied; `/api/health` shows `"schema":"0760"`
- [ ] Service-role key rotated; new key in Vercel and GitHub only
- [ ] Custom SMTP working: sign up a test account and receive the email
- [ ] Auth Site URL and Redirect URLs set to the production domain
- [ ] All legal variables set; `/terms`, `/privacy`, `/dpa` show your company name and address
- [ ] A lawyer has reviewed Terms, Privacy Notice and DPA for your company and markets ([compliance/README.md](compliance/README.md))
- [ ] Super admin assigned: `node scripts/set-super-admin.mjs you@yourdomain`
- [ ] CI green, including browser tests; Deploy database baselined; `APP_URL` variable set
- [ ] End-to-end check on production with two browsers (teacher and student): join, lockdown, screen strip, leave alert
- [ ] `node scripts/smoke.mjs` passes against production

## 5. Operating it

- **Errors:** `/super/errors` lists crashes from browsers and the server, grouped by cause.
- **Audit:** `/super/audit` (platform) and Admin → Audit (each school).
- **Uptime:** the GitHub *Uptime* workflow, or point UptimeRobot or Better Stack at `/api/health`.
- **Maintenance:** runs hourly in the database; the GitHub *Maintenance* workflow is a daily backup of the same job.

## 6. When something goes wrong

| Problem | Do this |
|---|---|
| Bad app release | Vercel → Deployments → previous deployment → **Promote to production** (instant rollback). |
| Bad database migration | Write a new migration that reverses it and push it. For data loss, restore with PITR to the minute before (Supabase → Database → Backups). |
| Leaked key | Rotate it in Supabase, update Vercel and GitHub, redeploy. Review `/super/audit` and the Supabase auth logs. |
| Personal data breach | Follow [compliance/INCIDENT_RESPONSE.md](compliance/INCIDENT_RESPONSE.md). Schools must be told within 48 hours. |
| Emails not arriving | Supabase → Auth → Logs; check the SMTP provider's dashboard and your domain's SPF/DKIM records. |
