# SwiftCipher API

## REST v1 (`/api/v1/*`, blueprint §10)

**Authentication:** use the browser session cookie, or send `Authorization: Bearer <access_token>` with a token from `POST /api/v1/auth/login`. Every call runs as that user, so RLS and the RPC permission checks apply.

**Errors:** `{ "error": "…", "code": "<pg code>" }`. HTTP statuses map as follows:

| Status | Meaning |
|---|---|
| 400 | Invalid input |
| 401 | Not authenticated |
| 403 | Forbidden |
| 404 | Not found |
| 409 | A business rule was violated |

| Method | Path | Body / query | Notes |
|---|---|---|---|
| POST | `/auth/login` | `{email, password}` | → `{access_token, refresh_token, expires_at}` |
| POST | `/auth/logout` | | |
| POST | `/auth/refresh` | `{refresh_token}` | Refresh tokens rotate |
| POST | `/auth/sso/callback` | `{code}` | PKCE code exchange |
| GET | `/me` | | Profile, tenant, plan, settings |
| GET/POST | `/lessons` | `?status=` / `{title, …}` | |
| GET/PATCH | `/lessons/:id` | | GET includes slides and activities |
| POST | `/lessons/:id/publish` | | Creates an immutable version |
| POST | `/lessons/:id/duplicate` | `{title?, as_template?}` | |
| POST | `/lessons/import` | | Use `POST /api/lessons/import` (multipart `file`) |
| POST | `/lessons/:id/activities` | `{kind, title, instructions?, settings?}` | |
| PATCH/DELETE | `/activities/:id` | | |
| POST | `/activities/:id/launch` | `{session_id}` | Opens the activity for the class |
| POST | `/activities/:id/responses` | `{session_id? \| assignment_id?, question_id, response}` | Server-graded |
| GET | `/activities/:id/results` | `?session_id=` | Distribution and accuracy |
| POST | `/games` | `{class_id, activity_id, settings?, session_id?, title?}` | |
| GET | `/games/:id` | | Current state; no answer keys |
| POST | `/games/:id/join` | `{nickname?}` | |
| POST | `/games/:id/start`, `/next`, `/end` | | Host only |
| POST | `/games/:id/answer` | `{question_index, choice, client_elapsed_ms?}` | One answer per question |
| GET | `/games/:id/leaderboard` | `?limit=` | Respects visibility settings |
| POST | `/class-sessions` | `{class_id, lesson_id?, mode?, environment_id?, title?}` | Starts live |
| POST | `/class-sessions/join` | `{code}` | Student |
| POST | `/class-sessions/:id/start`, `/end` | | End writes attendance and a report |
| GET | `/class-sessions/:id/presence` | | Roster with presence and device state |
| GET | `/class-sessions/:id/screens` | | Latest thumbnails, with stale frames flagged |
| POST | `/class-sessions/:id/announcements` | `{body}` | |
| POST | `/class-sessions/:id/commands` | `{student_ids[], kind, payload}` | open_tab, close_tab, redirect, focus, unfocus, lock, unlock, close_other_tabs, message, screenshot |
| GET | `/devices/:id/status` | | Diagnostics |
| POST | `/devices/:id/commands` | `{session_id, kind, payload}` | |
| POST | `/devices/:id/screenshot-request` | `{session_id}` | |
| POST | `/environments` | policy fields | |
| PATCH | `/environments/:id` | policy fields | Audited |
| POST | `/class-sessions/:id/environment/start` | `{environment_id}` | |
| POST | `/class-sessions/:id/environment/stop` | | |
| GET | `/class-sessions/:id/environment-events` | | |
| POST | `/environment-events/:id/acknowledge` | `{action: acknowledge\|dismiss\|confirm\|mute, scope?}` | |

## Device-agent gateway (`/api/devices/*`)

The extension uses these endpoints. They do not use a user session; every call except `enroll` must include `device_id` and `secret`.

| Path | Body | Returns |
|---|---|---|
| `POST /api/devices/enroll` | `{code, label, os, browser, version}` | `{device_id, secret, student_name, notice}` |
| `POST /api/devices/heartbeat` | `{device_id, secret, url?, title?, tab_count?, idle_state, version}` | Directives: `state` (`idle`\|`active`\|`unassigned`), `session`, `verdict`, `notice`, `policy`, `capture{enabled, interval_seconds, high_quality}`, `commands[]` |
| `POST /api/devices/events` | Same as heartbeat, plus `kind` | Same directives |
| `POST /api/devices/snapshot` | `{device_id, secret, image, width, height, quality, url}` | `{stored}` |
| `POST /api/devices/commands/ack` | `{device_id, secret, command_id, ok, error?}` | |
| `POST /api/devices/status` | `{device_id, secret}` | Owner, school, notice, live session |

The `image` for a snapshot must be a `data:image/jpeg` URL no larger than 400 KB. The database rate-limits snapshots and discards them when no session is live.

A `401` response means the device was disabled or unenrolled remotely, or the secret is wrong. Rate limits apply per device.

## Other routes

| Route | Purpose |
|---|---|
| `POST /api/lessons/import` | Multipart `file` (pptx, pdf, docx, md, txt), optional `title`; creates a draft lesson |
| `POST /api/roster/import` | `{class_id, csv, send_email}`; one invite code per student |
| `POST /api/admin/invites` | Staff or parent invites, emailed when the service role is set |
| `DELETE /api/admin/users/:id` | Deletion workflow |
| `POST /api/reports` | Generate a report |
| `GET /api/reports/:id/export` | Download a report as CSV |
| `POST /api/billing/checkout` | Start a Stripe checkout |
| `POST /api/billing/webhook` | Stripe webhook (signature verified) |
