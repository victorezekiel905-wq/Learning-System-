# Setting up SwiftCipher

## 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com). Postgres 15 or newer is required.
2. Under **Project Settings → API**, copy the Project URL, the `anon` key and the `service_role` key.
3. Under **Authentication → URL Configuration**:
   - Set **Site URL** to your app URL, e.g. `https://swiftcipher.yourschool.org`.
   - Add these **Redirect URLs**: `https://<your-app>/auth/callback` and `http://localhost:3000/auth/callback`.
4. Under **Authentication → Providers**, keep Email enabled. To add SSO (§6), also enable Google or Azure (Microsoft), then set `NEXT_PUBLIC_SSO_PROVIDERS=google,azure`.
5. Under **Authentication → SMTP**, configure SMTP for production. The built-in sender is heavily rate-limited, and invites, confirmations and password resets all send email.
6. Under **Realtime → Settings**, allow private channels. Live whiteboard annotation uses a private broadcast channel, authorised by the `realtime.messages` policies in migration 0670.
7. Optional: enable the `pg_cron` extension under **Database → Extensions** **before** you push the migrations. Nightly retention (§20) will then schedule itself. Without it, use the "Apply retention now" button or run `select app.apply_retention_all()` from your own scheduler.

## 2. Environment

```bash
cp .env.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_APP_URL`. Never commit `.env.local`; it is already in `.gitignore`.

## 3. Database

```bash
npx supabase login
npx supabase link --project-ref <project-ref>      # asks for the DB password
npx supabase db push                               # applies supabase/migrations in order
node scripts/smoke.mjs                             # verifies the live project end to end
```

The migrations create the full schema, RLS, RPCs, storage buckets (`lesson-media`, `submissions`), the realtime publication and the seed catalogues (plans, roles, domain categories). You can apply them again to a fresh project at any time.

## 4. Run

```bash
npm ci
npm run dev
```

Go to `/signup`, create your school, and follow the setup checklist on `/admin`.

### Deploying (Vercel or any Node host)

- **Vercel:** import the repo and set the environment variables above. No other configuration is needed.
- **Docker:** run `docker compose up --build`. The Dockerfile builds a standalone, non-root image.
- Set `NEXT_PUBLIC_APP_URL` to the public URL. The device agent always treats that host as allowed, and auth emails link back to it.

## 5. Browser extension (Guard)

**For testing:** open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose `extension/`. Open the popup, enter your server URL, then enter a pairing code from **This device** (student) or **Devices** (IT admin).

**For production** (Google Admin console or Microsoft Intune/Edge policies):

1. Publish the extension privately to your organisation, or host the CRX file.
2. Force-install it on managed student organisational units only.
3. Push the managed configuration so students can't point the extension at another server:

```json
{ "serverUrl": { "Value": "https://swiftcipher.yourschool.org" }, "deviceLabel": { "Value": "Lab A" } }
```

The extension only sends browsing telemetry and screenshots while the paired student is in a **live** class session. IT admins can disable or unenrol a device remotely from **Devices**.

## 6. Billing (optional)

1. Create Stripe prices for Teacher Pro, School and School Plus. Set `STRIPE_SECRET_KEY` and `STRIPE_PRICE_*`.
2. Add a webhook endpoint at `https://<app>/api/billing/webhook` for the `customer.subscription.*`, `invoice.paid` and `invoice.payment_failed` events. Set `STRIPE_WEBHOOK_SECRET`.
3. Plan changes are applied only by the signature-verified webhook, never by the browser.

Without Stripe, change a school's plan manually with SQL:

```sql
select public.billing_apply_subscription('<tenant_id>', 'school', 'active', 'manual', 'manual-<tenant>', null);
```

Run this with the service role, for example in the SQL editor.

## 7. TURN (optional)

Peer-to-peer screen sharing works on most networks. On strict school firewalls, deploy a TURN server (e.g. coturn) and set `NEXT_PUBLIC_TURN_URL`, `_USERNAME` and `_CREDENTIAL`. For large-class group video, put an SFU (e.g. LiveKit) behind the same room model.
