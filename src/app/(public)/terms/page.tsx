import { LegalPage } from "@/components/LegalPage";
import { LEGAL, operatorName } from "@/lib/legal";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  const op = operatorName();
  return (
    <LegalPage title="Terms of Service" intro={<p>These terms are an agreement between {op} (&ldquo;we&rdquo;) and the school or organisation that creates a SwiftCipher workspace (&ldquo;the School&rdquo;), and they also set the rules for every person who uses it. By creating an account or workspace you accept them.</p>}>
      <h2>1. The service</h2>
      <p>SwiftCipher provides interactive lessons, activities, quizzes and games with leaderboards, live classes, classroom focus and monitoring tools, messaging, reports and administration features, as described on the site and in the plan the School selects.</p>

      <h2>2. Accounts</h2>
      <ul>
        <li>The person who creates a workspace confirms they have authority to act for the School.</li>
        <li>Users must keep their passwords confidential and tell their school administrator about any unauthorised use.</li>
        <li>The School controls who has access, can suspend or delete users, and is responsible for the accuracy of its rosters.</li>
      </ul>

      <h2>3. The School's responsibilities</h2>
      <ul>
        <li>To have a lawful basis for its use of SwiftCipher and to give students, parents and staff the notices required by law, including about classroom monitoring and screen sharing.</li>
        <li>To obtain parental or guardian consent where the law requires it for children, before students use features that need it.</li>
        <li>To use monitoring features only for teaching, supervision and safety during class, and never to make automated disciplinary decisions from alerts.</li>
        <li>To configure retention and other privacy settings to meet its own obligations.</li>
      </ul>

      <h2>4. Acceptable use</h2>
      <p>Nobody may use SwiftCipher to break the law; to harass, bully or exploit anyone; to upload malware or content they have no right to share; to try to access another school's data or another person's account; to probe, overload or bypass the security of the service; or to resell it without our written agreement. We may suspend accounts that do.</p>

      <h2>5. Data</h2>
      <p>The School owns its data, and so do its users. We process personal data only to provide the service, as set out in the <a href="/privacy">Privacy Notice</a> and the <a href="/dpa">Data Processing Agreement</a>, which forms part of these terms for every School. We do not sell data, show advertising, or use student data to train AI models.</p>

      <h2>6. Plans, fees and billing</h2>
      <ul>
        <li>Paid plans are billed in advance through our payment provider, or by invoice when agreed in writing. Fees do not include taxes unless stated.</li>
        <li>If a payment fails we'll tell the School, and we may move the workspace to the free plan after 14 days. Data isn't deleted because a payment failed.</li>
        <li>We give at least 30 days' notice of price changes, which take effect at the next renewal.</li>
      </ul>

      <h2>7. Availability and support</h2>
      <p>We work to keep SwiftCipher available at all times except for planned maintenance, which we schedule outside school hours where possible and announce in advance. Support is available at {LEGAL.supportEmail ? <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a> : "the support address published on this site"}. Any service level commitments for a particular School are set out in its order form.</p>

      <h2>8. Suspension and termination</h2>
      <ul>
        <li>The School may stop using SwiftCipher at any time and delete its workspace from the admin settings, or ask us to delete it.</li>
        <li>We may suspend a workspace for a serious breach of these terms, or to protect users or the service, and will tell the School why.</li>
        <li>After termination the School can export its data for 30 days. We then delete it, except where the law requires us to keep it.</li>
      </ul>

      <h2>9. Intellectual property</h2>
      <p>We own the SwiftCipher software and brand. The School and its teachers own the lessons and content they create, and give us only the rights needed to host and display them in the service.</p>

      <h2>10. Warranties and liability</h2>
      <p>We provide the service with reasonable skill and care. Beyond that, and to the extent the law allows, it is provided &ldquo;as is&rdquo;. Except for liability that can't be limited by law (such as fraud, or death or personal injury caused by negligence) and each party's data protection obligations, each party's total liability under these terms is limited to the fees paid by the School in the 12 months before the claim. Neither party is liable for indirect or consequential loss.</p>

      <h2>11. Changes to these terms</h2>
      <p>We'll give Schools at least 30 days' notice of material changes. Users are asked to accept updated terms when they next sign in.</p>

      <h2>12. Governing law</h2>
      <p>These terms are governed by the laws of {LEGAL.governingLaw}, and the courts there have jurisdiction, unless the School's order form or its public-sector procurement rules say otherwise.</p>
    </LegalPage>
  );
}
