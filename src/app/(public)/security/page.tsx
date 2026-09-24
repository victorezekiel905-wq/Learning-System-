import { LegalPage } from "@/components/LegalPage";
import { LEGAL } from "@/lib/legal";

export const metadata = { title: "Security" };

export default function SecurityPage() {
  return (
    <LegalPage title="Security" intro={<p>How SwiftCipher protects schools' data. Security questionnaires and a signed <a href="/dpa">DPA</a> are available on request.</p>}>
      <h2>Isolation between schools</h2>
      <p>Every table in the database enforces row-level security, so one school can never read or change another school's data, even if the application has a bug. Automated tests check this isolation on every change before it ships.</p>

      <h2>Access control</h2>
      <ul>
        <li>Roles: student, parent, teacher, IT administrator and school administrator, each with the least privilege it needs.</li>
        <li>Sensitive actions (grading, device control, games scoring) run as audited server functions, never directly from the browser.</li>
        <li>Teachers' screen views, device commands, policy changes and administrative actions are recorded in each school's audit log.</li>
        <li>Single sign-on with Google or Microsoft can be enabled for a deployment.</li>
      </ul>

      <h2>Encryption</h2>
      <p>All connections use HTTPS with HSTS. Data is encrypted at rest by the database and storage provider. Device keys are stored only as one-way hashes.</p>

      <h2>Application security</h2>
      <ul>
        <li>A strict Content Security Policy. Student code runs in isolated workers with no access to the SwiftCipher API.</li>
        <li>Rate limits on screen uploads, device traffic and error reporting.</li>
        <li>Automatic error monitoring, so failures are seen and fixed quickly.</li>
      </ul>

      <h2>Privacy by design</h2>
      <p>Classroom monitoring only runs during live classes, students can always see when their screen is shared, live screen pictures are deleted when the class ends, and data retention runs automatically.</p>

      <h2>Reporting a vulnerability</h2>
      <p>Please report security issues to {LEGAL.supportEmail ? <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a> : "our support address"} with the subject &ldquo;Security&rdquo;. We acknowledge reports within two working days and don't take action against good-faith research that avoids harm to users and data.</p>
    </LegalPage>
  );
}
