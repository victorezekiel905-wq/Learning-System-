import { LegalPage } from "@/components/LegalPage";
import { LEGAL, SUBPROCESSORS, operatorName } from "@/lib/legal";

export const metadata = { title: "Privacy Notice" };

export default function PrivacyPage() {
  const op = operatorName();
  return (
    <LegalPage title="Privacy Notice" intro={<p>This notice explains what personal data SwiftCipher processes, why, for how long, and the rights of students, parents and school staff. It is written to meet the Nigeria Data Protection Act 2023 (NDPA), the EU and UK GDPR, and, for schools in the United States, FERPA and COPPA.</p>}>
      <h2>1. Who is responsible</h2>
      <p><strong>Your school is the data controller</strong> for everything about its students, staff and parents: it decides to use SwiftCipher, which features to switch on, and how long to keep data. {op} is the <strong>data processor</strong> and handles that data only on the school&apos;s documented instructions, under the <a href="/dpa">Data Processing Agreement</a>.</p>
      <p>{op} is the controller only for account security, billing contacts of schools that pay, and service operation logs (for example error reports).</p>

      <h2>2. What we process</h2>
      <ul>
        <li><strong>Account data:</strong> name, email address, role, school, class memberships, optional nickname.</li>
        <li><strong>Learning data:</strong> lesson responses, quiz and game answers and scores, submissions, grades, feedback, attendance, messages to teachers and class chat.</li>
        <li><strong>Live-class data (only while a teacher is running a live class):</strong> presence, whether the lesson is in front of the student, and, if the student shares their screen or uses a school-managed browser, low-resolution pictures of the screen and the address of the current website.</li>
        <li><strong>Alerts:</strong> when a student leaves a locked-down class or opens a blocked site, a record of what happened and, only if the school turned it on, the screen picture at that moment.</li>
        <li><strong>Technical data:</strong> sign-in records, IP address and browser type in security logs, and error reports (the page and technical details of a crash, without the content of the page).</li>
      </ul>
      <p>We do not use advertising, analytics or tracking cookies, we do not build marketing profiles, and we never sell personal data. Student data is never used to train AI models.</p>

      <h2>3. Screen sharing and classroom monitoring</h2>
      <ul>
        <li>Nothing is collected outside a live class. Screen sharing starts only when the student presses <em>Share screen</em>, the browser always asks the student to confirm, and a visible indicator shows while it&apos;s on. It stops when the class ends.</li>
        <li>Only the student&apos;s own teachers (and school administrators) can see the pictures. When a teacher opens one student&apos;s screen, no other student sees it. A teacher can show a screen to the class only with an on-screen notice to that student, and the student&apos;s name can be hidden.</li>
        <li>Live screen pictures are replaced every few seconds and <strong>deleted as soon as the class ends</strong>. There is no video recording.</li>
        <li>Alerts are a prompt for a teacher to check in with a student. SwiftCipher never makes disciplinary decisions automatically.</li>
      </ul>

      <h2>4. Why we process it (legal bases)</h2>
      <ul>
        <li>To provide the service the school has chosen: performance of the school&apos;s contract, and the school&apos;s public-interest or legitimate-interest basis for delivering education.</li>
        <li>For students under 18 (or the age set by local law), the school is responsible for obtaining any consent required from a parent or guardian, including for screen sharing.</li>
        <li>For security, fraud prevention and fixing errors: legitimate interests in keeping the service safe and working.</li>
        <li>For billing: contract with the paying school, and legal obligations for tax records.</li>
      </ul>

      <h2>5. How long we keep it</h2>
      <ul>
        <li>Live screen pictures: deleted when the class ends.</li>
        <li>Browsing telemetry, alerts and alert screenshots: 30 days by default (the school can set 1–365 days).</li>
        <li>Learning records (answers, attempts, games, chat): 730 days by default (the school can set 30–3,650 days).</li>
        <li>Notifications: 90 days. Error reports: 30 days.</li>
        <li>Accounts: until the school or the person deletes them. Deleting a school deletes all of its data.</li>
        <li>Deleted data can remain in encrypted backups until those backups expire, normally within 30 days.</li>
      </ul>
      <p>Retention runs automatically every hour.</p>

      <h2>6. Who else processes it (sub-processors)</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="table text-sm">
          <thead><tr><th>Provider</th><th>Purpose</th><th>Data</th><th>Location</th></tr></thead>
          <tbody>{SUBPROCESSORS.map((s) => <tr key={s.name}><td>{s.name}</td><td>{s.purpose}</td><td>{s.data}</td><td>{s.location()}</td></tr>)}</tbody>
        </table>
      </div>
      <p>Where data leaves Nigeria, the UK or the EEA, it is protected by the safeguards the law requires, such as standard contractual clauses and the provider&apos;s security commitments. Schools are told about new sub-processors at least 30 days in advance.</p>

      <h2>7. Security</h2>
      <p>Each school&apos;s data is isolated at the database level. All traffic is encrypted, and teachers&apos; access to screens is recorded in an audit log. See <a href="/security">Security</a> for details.</p>

      <h2>8. Your rights</h2>
      <p>You can ask for access to your data, a copy of it in a portable format, correction, deletion, or restriction, and you can object to processing. Signed-in users can download their data from <em>Account → Your data → Download my data</em>. School administrators can export or delete any member&apos;s data from <em>Admin → Users</em>.</p>
      <p>Because the school controls student data, send requests to your school first. If you contact us, we&apos;ll pass the request to your school and help it respond within the legal time limit (normally 30 days).</p>
      <p>You can complain to a data protection authority: in Nigeria the Nigeria Data Protection Commission (ndpc.gov.ng), in the UK the ICO, and in the EU your local supervisory authority.</p>

      <h2>9. Cookies</h2>
      <p>SwiftCipher only uses cookies that are strictly necessary to keep you signed in and to protect your session. Because there are no optional cookies, there is no cookie banner.</p>

      <h2>10. Changes</h2>
      <p>We&apos;ll tell schools about material changes at least 30 days in advance, and signed-in users are asked to review them.</p>

      <h2>11. Contact</h2>
      <p>{LEGAL.privacyEmail ? <>Privacy questions and requests: <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.</> : "Contact your school's administrator, who can reach us directly."}</p>
    </LegalPage>
  );
}
