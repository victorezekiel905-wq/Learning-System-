# Compliance pack

What SwiftCipher provides for data protection compliance, and what the operating company still has to do itself.

## In the product

| Requirement | Where |
|---|---|
| Privacy notice (NDPA 2023, GDPR, FERPA/COPPA context) | `/privacy` |
| Terms of Service | `/terms`, accepted at sign-up and recorded in `consents` |
| Data Processing Agreement (NDPA and GDPR Art. 28 terms) | `/dpa`, accepted by the school admin at sign-up |
| Security overview and vulnerability reporting | `/security`, `SECURITY.md` |
| Sub-processor list | `src/lib/legal.ts` (rendered in Privacy and DPA) |
| Consent records (Terms, privacy notice, monitoring notice) | `public.consents`; users who haven't accepted are asked in-app |
| Parental monitoring consent (signed undertakings) | Admin → Settings → Parental monitoring consent (bulk record with a reference, list of students missing); parents confirm or withdraw in the parent portal; optional "require consent before screens are shown"; all changes audited (`public.monitoring_consents`) |
| Right of access and portability | Account → Your data → Download my data; Admin → Users → Export |
| Right to erasure | Admin → Users → Delete; school deletion (super admin) |
| Retention limits | Per-school settings; enforced hourly by `app.run_maintenance()` |
| Data minimisation for monitoring | Live classes only, visible indicator, frames deleted when the class ends, alert screenshots off by default |
| Audit trail | `audit_logs` (per school), `platform_audit` (operator) |
| Tenant isolation | Row-level security on every table, tested in CI |
| Breach handling | [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) |
| Records of processing | [RECORDS_OF_PROCESSING.md](RECORDS_OF_PROCESSING.md) |
| DPIA for classroom monitoring | [DPIA.md](DPIA.md) |

## What the company must do (it can't be done in code)

1. **Legal review.** Have a lawyer admitted in your main market review `/terms`, `/privacy` and `/dpa` against your company and pricing. The texts are written for the NDPA and GDPR, but they are not legal advice.
2. **Register with the NDPC.** Under the NDPA 2023, organisations processing the data of many people (including children) in Nigeria must register with the Nigeria Data Protection Commission as a data controller or processor of major importance, and file annual compliance audit returns through a licensed Data Protection Compliance Organisation (DPCO).
3. **Appoint a Data Protection Officer** and publish their contact as `NEXT_PUBLIC_PRIVACY_EMAIL`.
4. **Sign the sub-processors' DPAs:** Supabase, Vercel, your SMTP provider, and Stripe (from each provider's dashboard or legal page).
5. **Security testing.** Commission an independent penetration test before the first large contract, then yearly. Many schools and districts ask for the report.
6. **Accessibility.** Run a WCAG 2.1 AA audit if you sell to public-sector schools.
7. **Outside Nigeria:** US schools will expect a signed Student Data Privacy Agreement (state-specific; see the Student Data Privacy Consortium). EU and UK schools will expect SCCs or IDTA wording for transfers.
