// Operator details shown in the Terms, Privacy Notice, DPA, Security page and
// contact links. The defaults are the operator's published contacts; any of
// them can be overridden per deployment with the environment variables named
// below. /api/health and /super report any detail that is still missing.

export const LEGAL = {
  /** Registered company name, e.g. "Example Technologies Ltd (RC 1234567)". */
  entity: process.env.NEXT_PUBLIC_LEGAL_ENTITY || "",
  /** Registered office address. */
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS || "",
  domain: process.env.NEXT_PUBLIC_COMPANY_DOMAIN || "synergyswift.com",
  /** Help with accounts and classes; also the security reporting address. */
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@synergyswift.com",
  /** General enquiries and sales. */
  infoEmail: process.env.NEXT_PUBLIC_INFO_EMAIL || "info@synergyswift.com",
  /** Privacy, data protection and data-subject requests. */
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL || "admin@synergyswift.com",
  /** Shown in international format; `phoneHref` is the tel: link. */
  phone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+234 816 647 0416",
  governingLaw: process.env.NEXT_PUBLIC_GOVERNING_LAW || "the Federal Republic of Nigeria",
  hostingRegion: process.env.NEXT_PUBLIC_HOSTING_REGION || "European Union: West EU (Ireland)",
  effectiveDate: process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE || "2026-09-24"
};

export const phoneHref = () => `tel:${LEGAL.phone.replace(/[^\d+]/g, "")}`;

/** Details that have no safe default and must be supplied before going live. */
export function missingLegalDetails(): string[] {
  const missing: string[] = [];
  if (!LEGAL.entity) missing.push("NEXT_PUBLIC_LEGAL_ENTITY (registered company name)");
  if (!LEGAL.address) missing.push("NEXT_PUBLIC_LEGAL_ADDRESS (registered address)");
  return missing;
}

/** Name used in legal text; the product name until the company name is configured. */
export const operatorName = () => LEGAL.entity || "SwiftCipher";

/** Every third party that processes personal data for the service. */
export const SUBPROCESSORS = [
  { name: "Supabase, Inc.", purpose: "Database, authentication, file storage and realtime messaging", data: "All service data", location: () => LEGAL.hostingRegion },
  { name: "Vercel Inc.", purpose: "Application hosting and content delivery", data: "Request metadata (IP address, browser), transient page data", location: () => "Application servers in Dublin, Ireland (EU); static files from a global content network" },
  { name: "Email delivery provider (configured SMTP)", purpose: "Account confirmation, invitations, password resets and alert emails", data: "Name, email address, email content", location: () => "As configured by the operator" },
  { name: "Stripe, Inc.", purpose: "Subscription billing (only if a school pays online)", data: "Billing contact, payment details (held by Stripe, never by SwiftCipher)", location: () => "United States / EU" },
  { name: "jsDelivr (Prospect One)", purpose: "Delivers the Python interpreter used by in-browser coding exercises", data: "IP address and browser details of the device downloading it; no account data", location: () => "Global CDN" }
];
