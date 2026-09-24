# Incident response plan

For security incidents and personal data breaches affecting SwiftCipher. Schools are told within **48 hours** (DPA §7). Each school must tell the regulator within **72 hours** where required (NDPA s.40, GDPR Art. 33).

## Roles

- **Incident lead:** the platform owner (super admin), who coordinates and decides.
- **DPO:** handles regulator and school communication (`NEXT_PUBLIC_PRIVACY_EMAIL`).
- **Engineer on call:** investigates, contains and fixes.

## 1. Detect (0–1 h)

Sources:
- the Uptime workflow failing;
- `/super/errors` spikes;
- Supabase auth and database logs;
- a report to the security address;
- a school's report.

Open an incident log. Record the time, who reported it, and what is known.

## 2. Contain (as soon as possible)

- Leaked credentials: rotate the Supabase service-role key or JWT secret, the Stripe keys and the SMTP password. Redeploy.
- A compromised account: suspend the user (`/super/users`) or the school (`/super/schools`).
- A bad release: Vercel → Promote the previous deployment.
- An abused feature: turn it off for the affected schools (Admin → Settings), or suspend.

## 3. Assess (within 24 h)

- What data, which schools, how many people, and whether children are affected.
- Is it a personal data breach (confidentiality, integrity or availability)?
- Likely risk to people: none, low, or high.
- Evidence: `audit_logs`, `platform_audit`, Supabase logs, Vercel logs. Preserve copies.

## 4. Notify

| Who | When | How |
|---|---|---|
| Affected schools (controllers) | Within 48 h of becoming aware | Email the school admins: what happened, the data and people affected, likely consequences, what we've done, contact point |
| NDPC or another regulator | Only if SwiftCipher is itself the controller (billing or operations data); schools notify for their data | Regulator's portal, within 72 h |
| People affected | When the risk is high and the school asks us to help | Wording agreed with the school |

## 5. Recover and learn (within 2 weeks)

- Fix the root cause and add a test that would have caught it.
- Write a short post-incident review: timeline, cause, impact, fixes, follow-ups.
- Update this plan, the DPIA and the records of processing if anything changed.
