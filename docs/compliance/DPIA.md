# Data protection impact assessment: classroom monitoring

Monitoring children's screens is high-risk processing, so the NDPA 2023 (s.28) and GDPR (Art. 35) require an impact assessment. This is SwiftCipher's assessment as processor. Schools can adopt it as the basis of their own, which they need as controllers.

## 1. What the processing is

During a **live class**, and only then, the student's lesson page asks the student to share their entire screen (the browser always shows its own permission prompt) and to open the lesson full screen. The page sends a small picture of the screen every few seconds to the class's teachers. It reports whether the lesson is in front of the student. If the student leaves (switches tab or app, exits full screen, stops sharing, or closes the lesson) for longer than the grace period, the teacher gets an alert. On school-managed Chromebooks and browsers, the extension can also report the active website and enforce the school's allowed-site list.

## 2. Is it necessary and proportionate?

- **Purpose:** keeping students safe and on task during teacher-led lessons, which is part of the school's duty of supervision.
- **Less intrusive options considered:** focus signals without screen pictures. These are available: the school can turn off screen capture, keep lockdown on, and teachers still get leave alerts. Screen pictures are an option for the school, not a requirement.
- **Limits built in:**
  - live classes only;
  - low resolution;
  - no video or recording;
  - pictures deleted when the class ends;
  - alert screenshots off unless the school turns them on;
  - only the class's teachers and school admins can view them;
  - every view is audited;
  - students always see an indicator;
  - the teacher can switch lockdown off.

## 3. Risks and mitigations

| Risk | Likelihood / severity | Mitigation | Residual |
|---|---|---|---|
| Private content (messages, personal tabs) captured on a shared screen | Medium / High | Students are told before sharing and see a live indicator. Monitoring is limited to class time. Pictures are deleted at class end. Schools are told to use school devices where possible. | Low–Medium |
| Staff misuse (watching students for non-teaching reasons) | Low / High | Access limited to the class's teachers. Audit log of screen views. Admins can review. Terms prohibit use for anything but teaching and safety. | Low |
| Automated decisions harming students (e.g. discipline from alerts) | Low / Medium | Alerts are prompts only. Grace periods, and connection loss is never counted as leaving. The documentation and privacy notice say this. | Low |
| Unauthorised access across schools | Low / High | Row-level security on every table, isolation tests in CI, a strict CSP, and sandboxed student code. | Low |
| Retention creep | Low / Medium | Hourly automatic retention; alert screenshots expire with telemetry (default 30 days). | Low |
| Children not understanding the processing | Medium / Medium | Plain-language student section in the privacy notice. The school gives notice and obtains parental consent where required. | Low–Medium |

## 4. Consultation and sign-off

- Schools should consult their DPO, and parent or student representatives where practical, before turning on screen sharing.
- If the residual risk is judged high, consult the Nigeria Data Protection Commission (or the relevant supervisory authority) before processing.

| Role | Name | Date | Decision |
|---|---|---|---|
| SwiftCipher DPO | | | |
| School DPO | | | |
