// Operator details shown in the Terms, Privacy Notice and DPA. Set them as
// environment variables on the deployment (see docs/DEPLOY.md). /api/health
// reports any that are missing so a deployment can't silently go live without them.

export const LEGAL = {
  entity: process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? "",
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS ?? "",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "",
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL ?? process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "",
  governingLaw: process.env.NEXT_PUBLIC_GOVERNING_LAW ?? "the Federal Republic of Nigeria",
  hostingRegion: process.env.NEXT_PUBLIC_HOSTING_REGION ?? "",
  effectiveDate: process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE ?? "2026-09-24"
};

export const LEGAL_ENV = ["NEXT_PUBLIC_LEGAL_ENTITY", "NEXT_PUBLIC_LEGAL_ADDRESS", "NEXT_PUBLIC_SUPPORT_EMAIL", "NEXT_PUBLIC_PRIVACY_EMAIL", "NEXT_PUBLIC_HOSTING_REGION"] as const;

/** Name used in legal text; falls back to the product name until the entity is configured. */
export const operatorName = () => LEGAL.entity || "SwiftCipher";

/** Every third party that processes personal data for the service. */
export const SUBPROCESSORS = [
  { name: "Supabase, Inc.", purpose: "Database, authentication, file storage and realtime messaging", data: "All service data", location: () => LEGAL.hostingRegion || "Region selected for the project" },
  { name: "Vercel Inc.", purpose: "Application hosting and content delivery", data: "Request metadata (IP address, browser), transient page data", location: () => "Global edge network; functions in the project's region" },
  { name: "Email delivery provider (configured SMTP)", purpose: "Account confirmation, invitations, password resets and alert emails", data: "Name, email address, email content", location: () => "As configured by the operator" },
  { name: "Stripe, Inc.", purpose: "Subscription billing (only if a school pays online)", data: "Billing contact, payment details (held by Stripe, never by SwiftCipher)", location: () => "United States / EU" },
  { name: "jsDelivr (Prospect One)", purpose: "Delivers the Python interpreter used by in-browser coding exercises", data: "IP address and browser details of the device downloading it; no account data", location: () => "Global CDN" }
];
