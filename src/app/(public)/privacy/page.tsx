export const metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-ink-700">
      <h1 className="text-3xl font-bold text-ink-900">Privacy notice</h1>
      <p className="mt-2 text-sm text-ink-500">This notice covers what SwiftCipher processes on behalf of your school.</p>

      <h2 className="mt-8 text-lg font-semibold text-ink-900">For students</h2>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        <li>Your school controls your account. Your teachers can see your answers, grades and participation in their classes.</li>
        <li>If your school manages your browser, your teacher can see the site you are on and a low-resolution picture of your screen, <strong>only while a class session is live</strong>. Nothing is collected outside class sessions.</li>
        <li>If your teacher shows your screen to the class, you are told first, and your name can be hidden.</li>
        <li>Alerts such as "off-task" are only a prompt for your teacher to check in. They are never used to make disciplinary decisions automatically.</li>
        <li>You can see what the browser extension reports on the "This device" page.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-ink-900">For schools</h2>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        <li>Each school's data is isolated from every other school at the database layer.</li>
        <li>Continuous screen recording is never stored. The latest thumbnail per device is deleted when the session ends. Event screenshots are off unless an administrator turns them on.</li>
        <li>Learning data and device telemetry have separate retention periods, which administrators can configure.</li>
        <li>Administrators can export or delete a person's data. Screen views, device commands and policy changes are recorded in the audit log.</li>
        <li>Parents only see summaries for their linked children, and only when the school enables the parent portal.</li>
      </ul>
    </main>
  );
}
