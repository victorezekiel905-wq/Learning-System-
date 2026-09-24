import Link from "next/link";
import { LEGAL, operatorName } from "@/lib/legal";

/** Shared frame for Terms, Privacy, DPA and Security pages. */
export function LegalPage({ title, intro, children }: { title: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-ink-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink-900 [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-ink-900 [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-2 [&_ul]:list-disc [&_ul]:pl-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Legal</p>
      <h1 className="text-3xl font-bold text-ink-900">{title}</h1>
      <p className="mt-2 text-sm text-ink-500">Effective {LEGAL.effectiveDate} · {operatorName()}</p>
      <div className="mt-4">{intro}</div>
      {children}
      <hr className="my-8 border-ink-200" />
      <nav className="flex flex-wrap gap-4 text-sm">
        <Link href="/terms">Terms of Service</Link><Link href="/privacy">Privacy Notice</Link>
        <Link href="/dpa">Data Processing Agreement</Link><Link href="/security">Security</Link>
      </nav>
      <Contact />
    </main>
  );
}

export function Contact() {
  return (
    <p className="mt-4 text-sm text-ink-500">
      {operatorName()}{LEGAL.address && `, ${LEGAL.address}`}.
      {LEGAL.privacyEmail && <> Privacy and data requests: <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.</>}
      {LEGAL.supportEmail && LEGAL.supportEmail !== LEGAL.privacyEmail && <> Support: <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>.</>}
    </p>
  );
}
