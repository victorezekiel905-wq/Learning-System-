import { LegalPage } from "@/components/LegalPage";
import { SUBPROCESSORS, operatorName } from "@/lib/legal";

export const metadata = { title: "Data Processing Agreement" };

export default function DpaPage() {
  const op = operatorName();
  return (
    <LegalPage title="Data Processing Agreement" intro={<p>This Data Processing Agreement (&ldquo;DPA&rdquo;) forms part of the <a href="/terms">Terms of Service</a> between {op} (&ldquo;Processor&rdquo;) and each School (&ldquo;Controller&rdquo;). It meets the processor-contract requirements of the Nigeria Data Protection Act 2023 and Article 28 of the EU/UK GDPR. A signed copy is available on request.</p>}>
      <h2>1. Subject matter and duration</h2>
      <p>The Processor processes personal data to provide SwiftCipher to the Controller for as long as the Controller has a workspace, plus the export and deletion period in section 9.</p>

      <h2>2. Nature and purpose</h2>
      <p>Hosting, storage, retrieval, display, transmission, analysis for reports, and deletion of data, in order to deliver lessons, assessment, games, live classes, classroom monitoring, messaging and administration.</p>

      <h2>3. Categories of people and data</h2>
      <ul>
        <li><strong>People:</strong> students (who may be children), teachers, school staff, parents and guardians.</li>
        <li><strong>Data:</strong> identity and contact details, class membership, learning activity and results, attendance, messages, live-class presence and focus signals, screen pictures during live classes, website addresses visited on school-managed browsers during live classes, and security logs.</li>
        <li><strong>Special categories:</strong> none are required by the service. The Controller shouldn't upload them unless it has a lawful basis to.</li>
      </ul>

      <h2>4. Processor obligations</h2>
      <ol>
        <li>Process personal data only on the Controller's documented instructions (these terms, the Controller's settings, and its written requests), and tell the Controller if an instruction seems to break the law.</li>
        <li>Make sure everyone authorised to process the data is bound by confidentiality.</li>
        <li>Put in place the technical and organisational measures in section 6.</li>
        <li>Use sub-processors only under section 5.</li>
        <li>Help the Controller respond to data subject requests, including through the self-service export and deletion tools.</li>
        <li>Help the Controller with security, breach notification, data protection impact assessments and consultation with regulators.</li>
        <li>Delete or return data at the end of the service (section 9).</li>
        <li>Make available the information needed to show compliance, and allow audits under section 8.</li>
      </ol>

      <h2>5. Sub-processors</h2>
      <p>The Controller authorises the sub-processors below. The Processor has a written contract with each one that gives protections at least as strong as this DPA, and it stays responsible for them. It will tell the Controller about any new sub-processor at least 30 days in advance, and the Controller may object on reasonable data protection grounds. If the objection can't be resolved, the Controller may terminate without penalty.</p>
      <div className="mt-2 overflow-x-auto">
        <table className="table text-sm">
          <thead><tr><th>Sub-processor</th><th>Purpose</th><th>Location</th></tr></thead>
          <tbody>{SUBPROCESSORS.map((s) => <tr key={s.name}><td>{s.name}</td><td>{s.purpose}</td><td>{s.location()}</td></tr>)}</tbody>
        </table>
      </div>

      <h2>6. Security measures</h2>
      <ul>
        <li>Tenant isolation enforced by row-level security on every table, with automated tests on every release.</li>
        <li>Encryption in transit (TLS 1.2 or later, with HSTS) and at rest (AES-256, provided by the hosting platform).</li>
        <li>Role-based access with least privilege. Screen views, device commands, policy changes and administrative actions are recorded in audit logs.</li>
        <li>Secrets such as device keys are stored only as hashes. Server credentials are kept out of source code and can be rotated.</li>
        <li>A strict content security policy, sandboxed execution of student code, rate limits on sensitive endpoints, and error monitoring.</li>
        <li>Automatic retention and deletion schedules, plus daily backups on the production hosting plan.</li>
        <li>Minimal data collection: no advertising or tracking, and live screen pictures are deleted when the class ends.</li>
      </ul>

      <h2>7. Personal data breaches</h2>
      <p>The Processor will tell the Controller without undue delay, and within 48 hours of becoming aware of a breach affecting the Controller's data. It will describe what happened, the data and people affected, the likely consequences, and the steps being taken. This lets the Controller meet its own deadline to notify the Nigeria Data Protection Commission or another regulator (72 hours under the NDPA and GDPR).</p>

      <h2>8. Audits</h2>
      <p>Once a year, or after a breach, the Controller may request written answers to reasonable security questionnaires and a summary of relevant third-party assessments. Where that isn't enough, an on-site or remote audit can be agreed with reasonable notice, confidentiality, and at the Controller's cost.</p>

      <h2>9. Deletion and return</h2>
      <p>When the service ends, the Controller can export its data for 30 days. After that the Processor deletes it from live systems, and it expires from backups within a further 30 days, unless the law requires it to be kept.</p>

      <h2>10. International transfers</h2>
      <p>Where personal data is transferred outside Nigeria, the UK or the EEA, the Processor makes sure an adequate transfer mechanism is in place, such as standard contractual clauses or the equivalent approved under the NDPA.</p>

      <h2>11. Precedence</h2>
      <p>If this DPA conflicts with the Terms of Service on the processing of personal data, this DPA prevails.</p>
    </LegalPage>
  );
}
