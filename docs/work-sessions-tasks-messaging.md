# Work sessions, overtime, tasks, messaging and offline mode

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

## 2. Overtime

Flow: **Normal work → Normal check-out → Start Overtime → "Overtime running" with a live timer → End Overtime.**

What is stored for each session (`OvertimeSession`):

- employee, date, start and end, duration;
- status, trigger (`AFTER_CHECKOUT`) and source;
- created and updated timestamps.

Overtime never changes the normal attendance record or its worked time.

Rules enforced by the server:

- Overtime can only start after the day's normal check-out, and not earlier than the check-out time.
- Only one overtime session can be active per employee (unique index), and sessions can't overlap.
- Ending overtime when none is running returns 409.
- The employee's manager is notified when overtime starts and when it is completed.

Who sees the records: HR and Super Admin see all overtime. Managers see their direct reports' overtime (attendance scope). Employees see only their own.

Overtime **approval and pay** are not part of this release. They are company policies that haven't been specified.

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

## 9. Configuration in code

| What | Where |
|---|---|
| Which tasks block checkout; exempt roles | `backend/apps/tasks/rules.py` (`BLOCKING_STATUSES`, `EXEMPT_ROLE_CODES`) |
| Offline event age and clock skew limits; batch size | `backend/apps/attendance/sessions.py` (`OFFLINE_MAX_AGE`, `OFFLINE_MAX_CLOCK_SKEW`, `MAX_EVENTS_PER_SYNC`) |
| Attachment types | `backend/apps/core/files.py` (`MESSAGE_EXTENSIONS`) |
| Attachments per message, message length | `backend/apps/messaging/services.py` |
| Client retry back-off, polling intervals | `frontend/src/lib/offline.ts`, `frontend/src/app/(app)/messages/page.tsx` |
