# Hosting on Render

This guide puts SwiftCipher online on [Render](https://render.com), with the database on Supabase. Allow about an hour.

The repository contains a Render Blueprint ([`render.yaml`](../render.yaml)). It creates one service:

| Render service | What it is | Plan |
|---|---|---|
| `swiftcipher` | The web app | Starter ($7/month) or higher. The free plan sleeps after 15 minutes idle, so the first teacher each morning would wait about a minute, and its 512 MB can run out while building. |

No scheduled jobs are needed on Render: hourly maintenance runs inside the database (pg_cron), and uptime checks run in GitHub Actions. Check current prices on render.com/pricing before you start.

## 1. Prepare the database (Supabase)

1. **Update the database.** SQL Editor → New query → paste all of [`supabase/updates/2026-09-27_RUN_THIS_update.sql`](../supabase/updates/2026-09-27_RUN_THIS_update.sql) → Run. The last row should show `schema = 0850` and every other column `true`. It is safe to run again. (A brand-new project runs [`supabase/setup.sql`](../supabase/setup.sql) instead.)
2. **Upgrade to Pro** before real schools use it (Settings → Billing). The free tier pauses idle projects, keeps no backups, and allows about 200 live connections. Then turn on **Point-in-time recovery** (Database → Backups).
3. **Realtime:** Project Settings → Realtime → turn **off** "Allow public access", so only the private, permission-checked channels work.
4. **Hourly maintenance:** Database → Extensions → enable **pg_cron**, then run the update file from step 1 once more. Check with `select * from cron.job;`.
5. **Email:** Authentication → SMTP → use your provider (Resend, SendGrid, Postmark, Amazon SES or Mailgun). The built-in sender only allows a few emails an hour, and invites, confirmations and password resets all send email.
6. **Keys:** Project Settings → API. Copy the **Project URL**, the **anon public** key and the **service_role** key. If the service_role key has ever been pasted anywhere (chat, email, a screenshot), generate a new one first. It bypasses all school isolation; it only ever goes into Render's secret settings.

## 2. Create the service on Render

1. Sign in to Render with the GitHub account that owns `victorezekiel905-wq/Learning-System-`.
2. Choose **New → Blueprint**, select the repository, and confirm the `main` branch.
3. Render asks for the values marked as secret. Fill in at least:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL, `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
| `NEXT_PUBLIC_APP_URL` | `https://swiftcipher.onrender.com` for now (Render shows the exact name), your own domain later |
| `NEXT_PUBLIC_LEGAL_ENTITY` | Registered company name, e.g. "Synergy Swift Ltd (RC 1234567)" |
| `NEXT_PUBLIC_LEGAL_ADDRESS` | Registered address |

   Leave the rest empty for now; features without keys stay off. They are explained in [`.env.example`](../.env.example).
4. Click **Apply**. The first build takes 3 to 6 minutes. When the service shows **Live**, open its URL: you should see the SwiftCipher home page.
5. Open `https://YOUR-APP/api/health`. It should show `"ok":true`, `"db":"up"`, `"schema":"0850"` and `"missing_legal_details":[]`.

Every push to `main` on GitHub now redeploys automatically.

**Changing a `NEXT_PUBLIC_` value later:** these are built into the pages, so after saving one choose **Manual Deploy → Deploy latest commit**. Saving alone is not enough.

## 3. Point Supabase at the app

Authentication → URL Configuration:

- **Site URL:** your Render address (or your domain, step 5).
- **Redirect URLs:** add `https://YOUR-APP/**`.

Without this, confirmation and password-reset emails link to the wrong place.

## 4. Make yourself super admin

1. Authentication → Users → **Add user → Create new user**, tick **Auto Confirm User**, set a strong password. Skip this if the account already exists.
2. Open [`supabase/scripts/make_super_admin.sql`](../supabase/scripts/make_super_admin.sql), change the email on the marked line, paste it into the SQL Editor and run it. The result shows the email that now holds the role. There is only one super admin: running it again with another email moves the role.
3. Sign in at `https://YOUR-APP/login`. You land on **/super**, where you create schools, appoint their admins, change their settings, and suspend, restore or delete them.

Turn on multi-factor authentication for this account in Supabase Auth.

## 5. Your own domain

1. In Render: **swiftcipher → Settings → Custom Domains**, add e.g. `app.synergyswift.com`, and create the DNS record Render shows at your domain registrar. HTTPS is set up automatically.
2. Change `NEXT_PUBLIC_APP_URL` to the new address, then **Manual Deploy → Deploy latest commit**.
3. Update the Supabase **Site URL** and **Redirect URLs** to the new address.
4. If you use Stripe, set its webhook to `https://YOUR-DOMAIN/api/billing/webhook`.

## 6. Before inviting schools

- [ ] `/api/health` shows `ok: true`, `schema: 0850`, no missing legal details
- [ ] A test sign-up receives its confirmation email
- [ ] `/terms`, `/privacy` and `/dpa` show your company name and address
- [ ] A live lesson with two browsers (teacher and student): join with the code, lockdown, the screen strip, a leave alert
- [ ] GitHub → Settings → Secrets and variables → Actions: set the variable `APP_URL` to your address, so the uptime check watches it ([DEPLOY.md §3](DEPLOY.md))

## After launch

- **Logs:** the service's **Logs** tab in Render. Errors from browsers and the server are also grouped at `/super/errors`.
- **Uptime:** the GitHub *Uptime* workflow, or point UptimeRobot or Better Stack at `/api/health`. Render's own health check uses the same address and restarts the app if it stops answering.
- **Rollback:** Render → **Events** → pick the previous deploy → **Rollback**.
- **Busy periods:** if pages slow down, move to the Standard plan or add instances. Live screens and alerts travel through Supabase Realtime, so the app itself stays light.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build fails mentioning Supabase | `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing; they are needed during the build. |
| Build stops with "out of memory" | The free plan. Use Starter or higher. |
| `/api/health` shows `db: "down"` | Wrong Supabase URL or key, or the Supabase project is paused (restore it in the dashboard). |
| `schema` is lower than `0850` | Run the update file in step 1.1. |
| Sign-in links go to localhost | `NEXT_PUBLIC_APP_URL` or the Supabase Site URL still points to localhost; redeploy after changing it. |
| `/super` says "page not found" | The account isn't the super admin yet (step 4). |
| Live screens never appear | Realtime public access is on, or the database update wasn't run. |
