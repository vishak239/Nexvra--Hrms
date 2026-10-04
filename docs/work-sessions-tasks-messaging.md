# Work sessions, attendance rules, overtime, WFH, tasks, messaging and offline mode

This guide covers the features added in the second release of Nexvra HRMS: what each one does, the rules the server enforces, and the known limits. The API reference is in [api.md](api.md) and the tables are in [database.md](database.md).

Who can do what:

| Feature | Super Admin | HR Admin | Manager | Employee |
|---|---|---|---|---|
| Breaks and overtime (own) | ✓ | ✓ | ✓ | ✓ |
| View breaks, overtime and sync log of others | everyone | everyone | direct reports | — |
| Assign, edit, remind and cancel tasks | ✓ | ✓ | — | — |
| View tasks | all | all | own + direct reports | own |
| Respond to and complete own tasks | ✓ | ✓ | ✓ | ✓ |
| Blocked at checkout by unanswered tasks | **never** | yes | yes | yes |
| Private messages and file sharing | ✓ | ✓ | ✓ | ✓ |
| Read other people's conversations | **no one** | no one | no one | no one |
| Activity monitoring (Reports tab) | company | company | team | — |

All of these rules are enforced by the Django API. The UI hides what a role can't use, but hiding is never the protection.

## 1. Break tracking

Flow: **Working → Start break → break timer runs → Back to work → Working**. Several breaks a day are allowed.

What is stored for each break (`BreakSession`):

- the employee and the day's attendance record (the work session),
- start and end time, duration in seconds,
- status (`ACTIVE` / `COMPLETED`) and source (`ONLINE`, or `OFFLINE` when synchronised later).

How time is calculated:

- **Actual working time = total session time − total break time.** `AttendanceRecord.total_break_seconds` is maintained by the server whenever a break ends.
- `worked_minutes` already excludes breaks, so half-day / full-day evaluation also uses the net figure.
- `session_minutes` is the gross check-in to check-out time.

Rules enforced by the server:

- You can't start a break unless you've checked in today and haven't checked out (409 otherwise).
- Only one break can be active at a time. A partial unique index enforces this in the database too.
- A new break can't start before the previous one ended, and can't start before check-in, so breaks never overlap.
- Ending a break when none is active returns 409.
- Checking out while on a break ends the break at the check-out time.

### Daily break allowance (owner policy: 60 minutes)

The allowance is the **total** break time per working day: `CompanySettings.break_allowance_minutes`, default 60. For example, 15 + 20 + 25 minutes = 60.

- **Start break** is refused (409 `break_allowance_used`) once the day's breaks add up to the allowance. The header and the card then show "Break unavailable for the day".
- A break that is still running when the allowance runs out is **closed by the server at that exact moment** (`end_reason=ALLOWANCE_EXHAUSTED`). The day's total therefore never exceeds the allowance, even if the browser was closed.
  - Pressing "End break" afterwards simply succeeds.
  - Ending a break after the allowance ran out is capped at the allowance.
- The work-session payload carries `break_used_seconds` and `break_remaining_seconds`, computed by the server. The card shows "Break used: XX min · Break remaining: YY min".
- Only real break sessions count. Opening a screen never does.
- A refresh, logout, lost connection or check-out never loses or double-counts break time. The break lives on the server, and an open break ends at check-out.
- HR can change the value or empty it (no limit) in **Settings → Working time & attendance**.

## 2. Overtime (declaration and approval)

```
Check-out ─► "Overtime" ─► declaration (tasks / other reason + description + confirmation)
   ─► REQUESTED ─HR/SA approve─► APPROVED ─"Start overtime"─► ACTIVE ─"Stop overtime"─► COMPLETED
                ─HR/SA reject──► REJECTED                     └─30 min without activity─► AUTO_STOPPED
   REQUESTED / APPROVED ─employee cancels─► CANCELLED;  an unused approval expires with its day
```

The **declaration** is required for every overtime session. The server re-checks every rule (`OvertimeRequestSerializer`):

- one or more of the employee's own **pending tasks** (`PENDING` / `IN_PROGRESS`) **or** "Other reason" with an explanation of 15+ characters;
- "What will you work on during overtime?", 10+ characters;
- the confirmation "I confirm that the above work is the reason for my overtime." The submit button stays disabled until all of this is valid.

**Approval** is controlled by `CompanySettings.overtime_requires_approval`, which is on by default. HR Admin and Super Admin hold `overtime.approve`; nobody can decide their own request.

- HR is notified of each request (`OVERTIME_REQUESTED`).
- The employee is notified and emailed of the decision.
- An approval is valid for its own date only.
- With approval switched off, a valid declaration starts the session directly.

**Activity.** While overtime runs, the same activity heartbeat applies. After 30 continuous minutes without activity, the server stops the session:

- `status=AUTO_STOPPED`, `end_reason=OVERTIME_INACTIVITY_TIMEOUT`;
- end = last activity + 30 min;
- the event is audited and the employee is notified.

The session never restarts silently. To continue, the employee submits a **new** declaration and approval, and every session has its own record.

**Anti-manipulation.** Start and end times, status, approval and inactivity state are set only by the server. Extra fields in the request (e.g. `status`, `started_at`) are ignored.

Overtime is still separate from normal worked time. Managers are notified when it starts and when it is completed. HR and Super Admin see all overtime; managers see their team's; employees see their own. Overtime **pay** is not part of the system.

## 2a. Office check-in geofence (owner policy: 20 metres)

HR sets the workplace once in **Settings → HR policies → Workplace & monitoring**: latitude, longitude, radius (default 20 m) and required GPS accuracy (default ±100 m). "Use my current location" fills in the coordinates while standing in the office. Until coordinates are set, the rule is not applied, and Settings says so.

**Check-in.** The browser asks for location permission, shows the distance and enables **Check in** only inside the radius. Outside, it shows "You are outside the workplace check-in area." with the approximate distance. The **server** decides:

- it recomputes the Haversine distance from the raw coordinates (`apps/attendance/geo.py`) and ignores any client-supplied distance or "inside" flag;
- missing coordinates → `400 location_required`;
- accuracy worse than the limit → `400 location_too_imprecise`;
- outside → `403 outside_geofence`. The boundary counts as inside.

**Stored data.** Check-in latitude, longitude, accuracy and distance, plus check-out coordinates and distance. The API exposes **distances only**, never coordinates, so no employee's precise location is shown to others.

**Automatic check-out on leaving.** While an office session is open, the app watches the location on any page and sends it with the activity heartbeat. The server checks the employee out (`checkout_reason=GEO_FENCE_EXIT`) only when a precise reading shows they have **clearly** left: distance minus accuracy is greater than the radius, so GPS jitter at the boundary never triggers it.

- It is not applied during a break, so lunch outside is fine, or for work-from-home sessions.
- The check-out is idempotent and audited, and the employee is notified.
- If location permission is revoked or unavailable, the server records a **monitoring problem** (`location_issue`, audited once per change) and does **not** claim the employee left.

## 2b. Activity and the 30-minute inactivity rule

While a session or overtime is open, the browser reports activity every 2 minutes (`POST /api/attendance/heartbeat/`), and immediately when the limit is reached. The report contains **only** the number of seconds since the last meaningful interaction, plus the location in office mode.

- **Counted:** clicks/taps, key presses (the key itself is never read), scrolling, deliberate pointer movement (small jitter is ignored) and returning to the tab.
- **Optional:** with the browser's Idle Detection permission (Chrome / Edge, "Also count activity in other apps"), activity anywhere on the device counts, still only as active/idle.
- **Never collected:** keystrokes, typed text, passwords, screenshots, microphone, page contents or browsing history.

The **server** keeps `last_activity_at`, which only moves forward and never precedes check-in. When `last_activity_at + 30 min` has passed with no break running, the session is checked out (`checkout_reason=INACTIVITY_TIMEOUT`, check-out time = last activity + 30 min). Example: last activity 10:00, still inactive at 10:29, checked out at 10:30.

- **During a break**, the clock pauses until the break allowance runs out.
- **Idempotent:** a session is checked out at most once, and repeated reports or reconciliations change nothing.
- **Audited:** reason, last activity and check-out time.
- **Not blocked by task checkout protection:** that rule applies to the employee's own check-out only.
- **Where it runs:**
  - on every heartbeat;
  - on every load of the work session;
  - before every manual check-out or break action;
  - on schedule for everyone: `manage.py reconcile_attendance` every 2 minutes (systemd timer / Windows Task Scheduler).

**Honest limits** (browsers cannot do more):

- Nothing runs in the browser while it is closed, and background tabs are throttled.
- Missing reports are therefore treated as **no activity**, which is never assumed to be work.
- An employee who keeps working offline for more than 30 minutes, or only in other applications without Idle Detection, will be checked out.
- A determined user can fake browser location or activity with developer tools. The data is evidence, not proof.

## 2c. Work from home

**Employee.**

- Opens **Work from home** in the header or on the card.
- Chooses a date (today or up to 90 days ahead), a reason (5+ characters) and optional remarks.
- One open request per date.
- Can cancel a pending request, or an approved one before using it.

**HR / Super Admin** (`wfh.approve`) use **Attendance → Work from home**:

- see the requests, with the employee, date, reason and remarks;
- approve or reject with an optional note;
- cannot decide their own request.

Notifications: request → approvers; decision → employee, in-app and by email. Every step is audited (`WFH_REQUESTED/APPROVED/REJECTED/CANCELLED`), including approver and time.

With an **approved request for today**, the employee gets **WFH check in**. The server verifies:

- the employee's identity;
- an APPROVED request with today's date (an approval for another day has expired);
- the attendance state.

The record gets `mode=WORK_FROM_HOME` and a link to the request. The geofence does not apply, no location is collected, and the inactivity rule still applies. Sending `mode=WORK_FROM_HOME` without an approval returns `403 wfh_not_approved`.

## 2d. One attendance state machine

The header and the card show the same server state and only the actions that are possible:

| State | Actions |
|---|---|
| Not checked in | Check in (office, inside the area) · WFH check in (approved WFH) · Work from home (request) |
| Working (office or WFH) | Break (until the allowance is used) · Check out · Work from home (request a date) |
| On break | End break |
| Checked out | Overtime (declaration) → "Overtime pending" → Start overtime (once approved) · Work from home |
| Overtime running | Stop overtime |

On wide screens the actions sit in the top-right header. Below 1280 px they collapse into an **Attendance** menu. The server rejects every invalid transition, whatever the browser sends.

## 3. Tasks

HR (anyone with `tasks.manage`) assigns a task to **one** employee, identified by **either**:

- the Employee ID (e.g. `EMP-1024`), or
- the username (e.g. `@vishak`).

The server resolves the identifier, refuses unknown, exited, inactive or self assignees, and stores the **internal employee id** as the relationship. Changing someone's username later never detaches their tasks. In the UI, HR presses **Find** first and sees who the identifier refers to before assigning.

| Field | Notes |
|---|---|
| title, description, priority (LOW/MEDIUM/HIGH/URGENT), due date | Editable by HR while the task is open |
| assigned_by, assigned_to | Set by the server; can't be changed by any edit |
| status | `PENDING → IN_PROGRESS → COMPLETED`, or `CANCELLED` (by HR). **OVERDUE** is derived: an open task whose due date has passed (`display_status`). It is always correct, so no background job is needed. |
| requires_response | When true (the default), the employee must respond before they can check out |
| acknowledged_at, response, responded_at, completed_at, cancelled_at | Timestamps of each step. The full response history is kept in `TaskResponse`. |

The employee can:

- acknowledge or start the task,
- respond (as many times as needed),
- mark it completed. A response is required first when `requires_response` is set.

The employee can't edit, reassign or cancel a task. HR can't respond on the employee's behalf.

Notifications:

- task assigned: "@vishak, HR assigned you a new task", with the Employee ID in the message;
- reminder (sent by HR);
- response and completion (to whoever assigned the task);
- cancellation (to the employee).

## 4. Task checkout protection

Before HR, a Manager or an Employee checks out, the server looks for **blocking** tasks. The rule is defined in one place, `backend/apps/tasks/rules.py`, so it is easy to change. A task blocks checkout when all of these hold:

- it is assigned to you;
- it has `requires_response = true`;
- its status is in `BLOCKING_STATUSES` (`PENDING`, `IN_PROGRESS`), so completed and cancelled tasks never block;
- you haven't responded yet.

Roles listed in `EXEMPT_ROLE_CODES` (Super Admin) are never blocked.

What happens:

- **Backend:** `POST /api/attendance/check-out/` returns `409` with code `checkout_blocked_by_tasks`. Calling the API directly can't bypass this.
- **Frontend:**
  1. Pressing **Check out** opens a "Respond to your tasks before checking out" dialog with each task, an **Open task** link and a response box.
  2. **Checkout** stays disabled until every task has a response.
  3. If the server refuses a checkout anyway (for example, a task assigned a second ago), the same dialog opens.

## 5. Leave approval lock and balance accounting

State machine (the existing leave module, extended):

```
PENDING ──approve──► APPROVED (locked)
PENDING ──reject───► REJECTED
PENDING ──cancel───► CANCELLED      (applicant only)
```

- **Approved leave is locked.** The applicant can't cancel it. The API answers `409` with "This leave has already been approved and cannot be cancelled." The UI shows a **Locked** badge and no Cancel button.
- **The balance decreases only on approval, exactly once.** The approval writes one `LeaveBalanceTransaction` (a ledger row) in the same database transaction. That transaction holds row locks on both the request and the balance.
- The ledger row is one-to-one with the leave request. The database therefore can't hold two deductions for the same request, whether the cause is a double click, a refresh, a network retry or concurrent approvals.
- Pending, rejected and cancelled requests never change the balance.
- `available` = allocated − deducted. `pending` is shown for information, and `requestable` = available − pending. New requests are checked against `requestable`, so pending requests can't over-commit the balance.
- The balance can never go negative: approval re-checks the balance under the lock, and a database check constraint backs this up. HR can't lower an allocation below the days already used.
- Every deduction is audited (`LEAVE_BALANCE_DEDUCTED`, with before and after values). It is also listed at `GET /api/leaves/balance-transactions/`.
- Upgrade: a data migration recorded one deduction for each request that was already approved, so existing balances are unchanged.

## 6. Private messaging and file sharing

- Find a colleague by **@username**, **Employee ID** or **name**. The people directory returns only a minimal card: name, username, Employee ID, designation and department.
- Conversations are one-to-one; there is one per pair of people. Messages are paginated, newest page first, with "Load earlier messages".
- You get unread counts per conversation and in total (the header shows a Messages badge), and the conversation is marked read when you open it.
- Access is strictly participant-only. Everything is filtered on "you are a participant", so any other conversation or attachment id returns `404`, including for HR and Super Admin. There is deliberately no administrative read access, and message contents are never written to the audit log.
- Attachments:
  - **Formats:** PDF, DOC, DOCX, XLS, XLSX, CSV, TXT, PNG, JPG/JPEG; up to 5 files per message; size limit from Settings (default 10 MB).
  - **Content checks:**
    - binary formats are checked by magic bytes;
    - DOCX/XLSX must be real Office packages (a renamed zip is refused);
    - CSV/TXT must be text with no binary bytes.
  - **Storage:** private storage (`PRIVATE_MEDIA_ROOT/message_files/`) under a random name. The original filename, type, size and uploader are kept as metadata.
  - **Download:** only through `GET /api/messages/attachments/{id}/download/`, after the participant check. Responses carry `Cache-Control: private, no-store` and `nosniff`.
- Notifications: "New message from …" or "… sent you N files". While unread, one notification per conversation is refreshed instead of a new one per message.
- Updates: an open conversation checks for new messages every 10 seconds, and the conversation list every 30 seconds, **only while the tab is visible**. Unread badges refresh on navigation and when the window regains focus. There is no WebSocket server in this release.

## 7. Work-session persistence and offline mode

The server is the source of truth: `GET /api/attendance/today/` returns the full work session plus `server_time`. The browser adds a persistence layer.

| Situation | What happens |
|---|---|
| Tab in the background / window minimised | Timers keep running. They are computed from timestamps, never by counting ticks. When you return, the session is refreshed from the server. |
| Browser closed and reopened | On the next visit the server's session is shown with "**Active work session detected.**", and **Resume session** continues the timers. Offline actions saved before closing are still queued and are sent. |
| Internet lost | The header shows **Offline mode**. **Start break / Back to work / Start overtime / End overtime** still work: they are saved on the device (localStorage, per user) with a client UUID and the device time corrected by the server-clock offset. The card shows them as "waiting to sync". Check-in and check-out need the server (the task rule and the one-session-per-day rule are checked there). |
| Connection back | The queue is sent to `POST /api/attendance/sync/` in the order things happened. |
| Browser process completely terminated | Nothing runs, and no browser can do otherwise. Recording resumes when the app is opened again. |

How synchronisation works:

- **Validation.** Each event is checked again by the server:
  - it must be no more than 5 minutes in the future (to allow for clock drift) and no older than 24 hours (`OFFLINE_MAX_AGE`);
  - it must fit the current state, for example not before check-in and not overlapping another break.
- **Idempotency.** `(user, client_event_id)` is unique in `SyncEvent`, so re-sending, retrying or a second tab never applies an event twice. Online break and overtime buttons send a client id too, so a request that timed out but reached the server is not applied twice.
- **Conflicts.** Example: a break started on another device. The event is stored as `CONFLICT` or `REJECTED` with a reason, is not applied, is shown under the header indicator as "Not applied by the server", triggers a notification and is audited.
- **Retry.** After a failed attempt, retries back off: 5 s, 15 s, 30 s, 60 s, then every 2 minutes. Queued events are never dropped on network errors.

Connection indicator states:

- **ONLINE** (quiet);
- **OFFLINE** ("Offline mode");
- **SYNCING**;
- **SYNCED** (briefly, after a successful sync);
- **SYNC ERROR** (a failed attempt or refused events; details and **Retry now** in the popover).

Known browser limitations:

- localStorage can be disabled (private modes, strict policies). The app then keeps the queue in memory only while the tab is open, and says so in the indicator.
- The device clock is only trusted within the bounds above. Offline timestamps are corrected by the last known server-clock offset.
- "Offline" means the browser reports no network *or* the HRMS server can't be reached; the server's health endpoint is probed every 10 seconds until it responds.

## 8. Monitoring

**Reports → Activity monitoring** lists, for a date range:

- **Attendance:** check-in/out, session, breaks and actual working time;
- **Breaks:** start, end, duration;
- **Overtime;**
- **Tasks:** assignee, assigned by, status, response, completion;
- **Leave decisions:** with deducted days;
- **Leave balance changes:** the ledger;
- **Offline synchronisation:** event, employee, device time, received time, status, error.

Each list comes from the same scoped endpoint the module uses, so managers see only their team and employees can't open the tab.

The dashboard also shows:

- **For HR and Super Admin:** "on break now" and "overtime running" counts, and open, overdue and awaiting-response tasks.
- **For each employee:** their open tasks and unread messages.

## 9. Company policies

**Policies** (in the main menu for everyone) shows:

- the rules the system enforces, read live from Settings: working days and hours, late grace, daily break allowance, half/full-day hours, leave year and self check-in. "Not set" means the rule isn't applied;
- the policy documents HR writes, such as conduct or communication (company chat) rules. They're searchable and filterable by category.

HR Admin and Super Admin (`policies.manage`) create, edit, publish and delete policies. Drafts are visible only to them, and the API returns 404 to anyone else. No policy text is seeded, because none was supplied.

## 10. Configuration in code

| What | Where |
|---|---|
| Geofence, inactivity, break allowance, overtime approval | **Settings** (database), not code |
| Heartbeat interval | `backend/apps/attendance/views.py` (`HEARTBEAT_SECONDS`) |
| Geofence / exit maths | `backend/apps/attendance/geo.py` |
| Which tasks block checkout; exempt roles | `backend/apps/tasks/rules.py` (`BLOCKING_STATUSES`, `EXEMPT_ROLE_CODES`) |
| Offline event age and clock skew limits; batch size | `backend/apps/attendance/sessions.py` (`OFFLINE_MAX_AGE`, `OFFLINE_MAX_CLOCK_SKEW`, `MAX_EVENTS_PER_SYNC`) |
| Attachment types | `backend/apps/core/files.py` (`MESSAGE_EXTENSIONS`) |
| Attachments per message, message length | `backend/apps/messaging/services.py` |
| Client retry back-off, polling intervals | `frontend/src/lib/offline.ts`, `frontend/src/app/(app)/messages/page.tsx` |
