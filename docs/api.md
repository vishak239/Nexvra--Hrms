# API Reference

Base path: `/api/`. JSON in and out (multipart for uploads). All URLs end with `/`.

- **Auth:** Django session cookie (`nexvra_session`, HttpOnly) + CSRF. Before any unsafe request (POST/PUT/PATCH/DELETE), send the `csrftoken` cookie value in the `X-CSRFToken` header. Call `GET /api/auth/csrf/` once to receive the cookie before logging in.
- **Errors:** `{"error": {"code", "message", "fields"}}`. Codes: `validation_error` (400), `not_authenticated` (401), `permission_denied` (403), `not_found` (404; also returned for objects outside your scope), `method_not_allowed` (405), `conflict` (409), `throttled` (429), `server_error` (500).
- **Lists:** paginated: `{count, next, previous, results}`, `?page=`, `?page_size=` (max 100), `?search=`, `?ordering=`, plus the filters listed below.
- **Decimals** (money, leave days) are always JSON strings, e.g. `"1150.00"`.
- **Scope:** *own* = your own records; *team* = you + your direct reports; *all* = everyone. A permission column of "—" means any authenticated user.
- Interactive schema: `/api/docs/` (Swagger UI) and `/api/schema/` (development only, `DEBUG=True`).

## Service

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/health/` | public | `{service, status, database}`: 200 when healthy, 503 if the database is unreachable. Used by `start-hrms.bat`. |
| GET | `/` (backend root) | public | Redirects to `FRONTEND_URL`, because the backend serves only the API |

## Authentication — `/api/auth/`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `csrf/` | public | Sets the `csrftoken` cookie |
| POST | `login/` | public, CSRF, throttled | `{email, password}` → current user (same as `me`). Generic error on failure. |
| POST | `logout/` | — | 204 |
| GET | `me/` | — | `{id, email, username, full_name, role{code,name,level}, permissions[], employee{id, employee_code, ...}|null}` |
| GET | `session/` | public | Always 200: `{authenticated, user}` where `user` has the same shape as `me` (or null). Used by the SPA on load. |
| POST | `change-password/` | — | `{current_password, new_password}` |
| POST | `password-reset/` | public, throttled | `{email}`. Always 200 (no enumeration). Emails a link to `FRONTEND_URL/reset-password?uid=&token=` |
| POST | `password-reset/confirm/` | public, throttled | `{uid, token, new_password}` |

## Users, roles, permissions

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `users/` | `users.view` | Filters: `is_active`, `role__code`; search email/name |
| POST | `users/` | `users.manage` | `{email, username?, first_name, last_name, role, is_active, password?}`. `username` is generated from the email when omitted. No password → set-password email. Can only assign roles ranked below your own (Super Admin excepted). |
| GET/PATCH | `users/{id}/` | `users.view` / `users.manage` | Can't change your own role or active status. Can't edit accounts at or above your level. Users are never deleted (405). |
| GET | `roles/` | `roles.view` (or `users.manage` / `employees.manage` for the list) | Includes `permissions[]` and `user_count` |
| POST/PATCH/DELETE | `roles/{id}/` | `roles.manage` | System roles can't be deleted and their code/level can't change. Super Admin's permissions are fixed (always all). Changes are audited. |
| GET | `permissions/` | `roles.view` | Permission catalogue |

## Company & settings

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET / PATCH | `company/` | — / `company.manage` | Company profile (singleton) |
| GET / PATCH | `settings/` | — / `settings.manage` | HR policy settings. Every field is nullable/optional: empty = rule not applied. See requirements-analysis.md §3. |

`settings` fields: `timezone`, `currency`, `working_days` (list of 0=Mon…6=Sun), `work_start_time`, `work_end_time`, `late_grace_minutes`, `break_allowance_minutes` (1–480; daily break allowance, e.g. 60), `half_day_min_hours`, `full_day_min_hours` (both or neither), `self_attendance_enabled`, `leave_year_start_month`, `employee_document_upload_enabled`, `deactivate_user_on_exit`, `max_upload_size_mb`.

## Organisation

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `departments/`, `designations/`, `holidays/` | — | `holidays/?year=` (not paginated) |
| POST/PATCH/DELETE | `departments/{id}/` | `departments.manage` | Deleting a department in use → 409 (deactivate instead) |
| POST/PATCH/DELETE | `designations/{id}/` | `designations.manage` | Same |
| POST/PATCH/DELETE | `holidays/{id}/` | `holidays.manage` | `{date, name, is_optional}`; unique per date+name |
| GET | `policies/`, `policies/{id}/` | — | Company policies. Filters: `q` (title/text), `category`, `status=published|draft` (managers only). Non-managers get published policies only; a draft is 404 for them. Paginated. |
| POST/PATCH/DELETE | `policies/{id}/` | `policies.manage` | `{title (unique, case-insensitive), category, body (≤ 20 000 chars), effective_date?, is_published}`. Audited (`POLICY_CREATED/UPDATED/DELETED`) without copying the policy text. |

Policy categories: `WORKING_HOURS`, `ATTENDANCE`, `BREAKS`, `LEAVE`, `HOLIDAYS`, `CONDUCT`, `COMMUNICATION`, `OTHER`.

## Employees — `/api/employees/`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `` | — (scoped: own / team / all) | Filters: `department`, `designation`, `employment_status`, `employment_type`, `manager`; search code/name/email |
| GET | `{id}/` | — (scoped) | Confidential fields (`phone`, `address`, emergency contact, `exit_date`, `role`, `is_active`) only for yourself and `employees.view_all` |
| POST | `` | `employees.manage` | Creates the login account too: `{email, username?, first_name, last_name, role?=EMPLOYEE, initial_password?, employee_code, joining_date, employment_type, department?, designation?, manager?, employment_status?, exit_date?, phone?, address?, emergency_contact_*}` |
| PATCH/PUT | `{id}/` | `employees.manage` | Same fields (no `initial_password`); `is_active` allowed. Escalation guards apply. `EXITED` requires `exit_date`. |
| DELETE | `{id}/` | — | 405: employees are never deleted (set `EXITED`) |
| GET/PATCH | `me/` | — | Self-service PATCH limited to `phone`, `address`, `emergency_contact_name/phone/relation` |
| GET/POST/DELETE | `{id}/photo/` | scoped; change = self or HR outranking them | Multipart `photo` (png/jpg, validated). GET streams privately. |

## Attendance — `/api/attendance/`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `` | — (scoped own/team/all) | Filters: `employee`, `status`, `is_late`, `date`, `date_from`, `date_to` |
| GET | `today/` | `attendance.self` | Work session (applies due time rules first): `{date, server_time, self_attendance_enabled, break_allowance_minutes, break_used_seconds, break_remaining_seconds, inactivity_timeout_minutes, heartbeat_seconds, overtime_requires_approval, workplace{configured, latitude, longitude, radius_m, max_accuracy_m}, wfh_today, open_overtime_request, record, breaks[], active_break, overtime[], active_overtime, blocking_tasks, checkout_exempt, active_meeting, active_pause, meeting_pauses[], non_working[], open_non_working, resume_request, required_work_seconds}`. `record` includes `total_meeting_seconds` / `meeting_minutes` and `total_non_working_seconds` / `non_working_minutes`; `worked_minutes` excludes breaks, meetings and non-working time. |
| POST | `check-in/` | `attendance.self` | `{mode?: OFFICE (default) \| WORK_FROM_HOME, latitude?, longitude?, accuracy?}`. Office with a configured workplace: the server computes the distance; **400 `location_required`**, **400 `location_too_imprecise`**, **403 `outside_geofence`**. WFH: **403 `wfh_not_approved`** without an approved request for today (no location collected). Any client "inside"/distance field is ignored. 409 on a duplicate check-in. After today's automatic inactivity check-out: **409 `resume_required`** (no request), **409 `resume_pending`**; with an approved Resume Work request the same validation runs and the day's session reopens (gap → non-working time). Checking in during a meeting that includes you starts paused. |
| POST | `check-out/` | `attendance.self` | `{latitude?, longitude?}` (optional, office). **409 `checkout_blocked_by_tasks`** while a blocking HR task is unanswered (Super Admin exempt); an open break ends at check-out; due inactivity rules are applied first. |
| POST | `heartbeat/` | `attendance.self` | Privacy-safe activity report: `{idle_seconds, activity?: [seconds-ago offsets of interactions not yet acknowledged, ≤ 3000], observed_seconds?, location_status?: ok\|denied\|unavailable\|timeout\|unsupported\|not_requested, latitude?, longitude?, accuracy?}` → `{changed, state}`. Applies inactivity check-out (evidence rules, see [meetings-resume-activity.md](meetings-resume-activity.md)) / overtime auto-stop / geofence exit. Activity is ignored during meetings. Throttle scope `heartbeat` (30/min). |
| GET | `breaks/` | — (scoped own/team/all) | Break history. Filters: `employee`, `status`, `source`, `date_from`, `date_to` |
| POST | `breaks/start/`, `breaks/end/` | `attendance.self` | Body `{client_event_id?: uuid}` (makes retries idempotent) → `{duplicate, state}` (state = `today/` payload). 409: not checked in / already checked out / already on a break / no break to end / overlap. |
| GET | `overtime/`, `overtime/{id}/` | — (scoped) | Filters: `employee`, `status` (REQUESTED…CANCELLED), `source`, `date_from`, `date_to`. Includes the declaration (tasks, description, other reason) and decision. |
| POST | `overtime/request/` | `attendance.self` | Declaration after check-out: `{task_ids[], use_other_reason, other_reason, work_description, declaration_confirmed: true}`. 400 when incomplete; tasks must be the caller's open tasks. → REQUESTED (approval on) or ACTIVE (approval off). `{state}` |
| POST | `overtime/{id}/approve/`, `/reject/` | `overtime.approve` | `{note?}`. Only REQUESTED; not your own; approval only for today or later. Notifies + emails the employee. |
| POST | `overtime/{id}/cancel/` | `attendance.self` (owner) | REQUESTED / APPROVED (not started) → CANCELLED |
| POST | `overtime/start/`, `overtime/end/` | `attendance.self` | Start = today's APPROVED session (409 otherwise); end → COMPLETED. Same `client_event_id` idempotency as breaks. Notifies the manager. |
| GET / POST | `wfh/` | — (scoped) / `attendance.self` | Work-from-home requests. Create `{date (today…+90 days), reason (5+ chars), remarks?}`; one open request per date. Filters: `employee`, `status`, `date`, `date_from`, `date_to` |
| POST | `wfh/{id}/approve/`, `/reject/` | `wfh.approve` | `{note?}`. Only PENDING; not your own; approve only for today or later. Notifies + emails the employee. |
| POST | `wfh/{id}/cancel/` | `attendance.self` (owner) | PENDING, or APPROVED and not yet used, date today or later |
| GET / POST | `meetings/` | — (overall + own for employees; all for `meetings.manage`) / `meetings.manage` | Create `{title, agenda?, kind: OVERALL\|SELECTED, participant_ids[] (SELECTED, ≥ 1), scheduled_start?, scheduled_end?}`. Filters: `status`, `kind`, `history=true` (completed / cancelled), `date_from`, `date_to`, `search` |
| PATCH | `meetings/{id}/` | `meetings.manage` | `{title?, agenda?, participant_ids?, scheduled_start?, scheduled_end?}` while SCHEDULED or ACTIVE. Changing participants of a running meeting pauses newcomers / resumes removed people now |
| POST | `meetings/{id}/start/`, `/end/`, `/cancel/` | `meetings.manage` | Start (SCHEDULED → ACTIVE, pauses affected open sessions; 409 on invalid overlap), end (ACTIVE → COMPLETED, working time continues), cancel (SCHEDULED only) |
| GET / POST | `resume-requests/` | — (scoped; all for `resume.approve`) / `attendance.self` | After today's automatic inactivity check-out: `{reason (10+ chars)}` → `{state}`. One open request per employee. Filters: `employee`, `status`, `date`, `date_from`, `date_to` |
| POST | `resume-requests/{id}/approve/`, `/reject/` | `resume.approve` | `{note?}`. Only PENDING; not your own; approve only on its day. Approval allows the next check-in (which still passes geofence / WFH validation) |
| POST | `resume-requests/{id}/cancel/` | `attendance.self` (owner) | PENDING or APPROVED and unused → `{state}` |
| POST | `sync/` | `attendance.self` | Offline queue: `{events: [{id: uuid, type: BREAK_START|BREAK_END|OVERTIME_START|OVERTIME_END, occurred_at}]}` (≤ 100). Applied in time order, idempotent per id → `{results: [{id, type, status: APPLIED|CONFLICT|REJECTED, duplicate, error}], state}` |
| GET | `sync-events/` | — (scoped) | Synchronisation log. Filters: `employee`, `status`, `channel` (`ONLINE`/`OFFLINE`), `event_type`, `date_from`, `date_to` |
| GET | `daily/?date=&department=` | `attendance.view_team` / `view_all` | Per-employee status: `PRESENT`, `HALF_DAY`, `ABSENT`, `ON_LEAVE`, `HOLIDAY`, `WEEKLY_OFF`, `NOT_MARKED` |
| POST/PATCH/DELETE | `` / `{id}/` | `attendance.manage` | HR corrections: `{employee, date, check_in?, check_out?, status?, remarks?}`. Status is computed if omitted. Can't correct your own records. Audited. |

Records have `status` ∈ `PRESENT | HALF_DAY | ABSENT`, `is_late`, `worked_minutes` (actual working time = session − breaks), `session_minutes` (gross), `break_minutes`, `total_break_seconds`, `break_over_allowance_minutes` (break time beyond the daily allowance; `null` when no allowance is set), `mode` (OFFICE/WORK_FROM_HOME), `checkout_reason` (MANUAL/GEO_FENCE_EXIT/INACTIVITY_TIMEOUT/ADMIN), `check_in_distance_m`, `check_out_distance_m` (coordinates are never returned), `last_activity_at`, `location_issue` and `source` (`SELF | ADMIN`). Late and half-day are computed only from configured settings. Details: [work-sessions-tasks-messaging.md](work-sessions-tasks-messaging.md).

## Leave — `/api/leaves/`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `types/` | — | Not paginated |
| POST/PATCH/DELETE | `types/{id}/` | `leave.manage_types` | `{name, code, is_paid, annual_allocation?, allow_half_day, is_active}`. `annual_allocation` empty = balance not tracked. |
| GET | `balances/` | — (scoped) | Filters: `employee`, `leave_type`, `year`. Each row includes `used` (deducted on approval), `pending` (information only) and `available` (= allocated − used). |
| GET | `balances/mine/?year=` | — | Own summary for every active type, plus `requestable` (= available − pending) |
| GET | `balance-transactions/` | — (scoped by leave) | Audited ledger of deductions: `{employee, leave_type_name, year, kind, days, balance_before, balance_after, leave_request, created_by_name, created_at}`. Filters: `employee`, `leave_type`, `year`, `date_from`, `date_to` |
| POST/PATCH/DELETE | `balances/{id}/` | `leave.manage_balances` | Can't change your own balance |
| POST | `balances/allocate/` | `leave.manage_balances` | `{leave_type, year, allocated?, employees?[], overwrite?}` → `{created, updated, skipped}` |
| GET | `requests/` | — (scoped) | Filters: `status`, `employee`, `leave_type`, `leave_year`, `date_from`, `date_to`. Rows include `can_decide`, `can_cancel`, `is_locked` and `balance_deducted`. |
| POST | `requests/` | `leave.apply` | Always for yourself: `{leave_type, start_date, end_date, is_half_day?, half_day_period?, reason?}`. Validates overlap, balance, working days. Notifies your manager (or HR when you have no manager). |
| GET | `requests/pending-approvals/` | `leave.approve_team` / `approve_all` | Requests you can decide |
| POST | `requests/{id}/approve/`, `reject/` | `leave.approve_team` (direct reports) / `leave.approve_all` | `{note?}`. Never your own request. Only `PENDING` (else 409). Approval deducts the balance exactly once (row-locked; one ledger row per request); 400 if the balance is insufficient at approval time. |
| POST | `requests/{id}/cancel/` | `leave.apply` (owner only) | **Pending only.** Approved leave is locked: 409 "This leave has already been approved and cannot be cancelled." |

## Payroll — `/api/payroll/`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET / write | `components/` | `payroll.view_all` or `payroll.manage` / `payroll.manage` | `{name, code, kind: EARNING|DEDUCTION, is_active}` |
| GET / write | `salary-structures/` | `payroll.view_all` / `payroll.manage` | `{employee, effective_from, notes?, items:[{component, amount}]}`. Response includes totals. Can't set your own salary. |
| GET | `runs/` | `payroll.view_all` | Includes `payslip_count`, `total_net` |
| POST | `runs/` | `payroll.manage` | `{year, month}`. One run per month (409). |
| POST | `runs/{id}/generate/` | `payroll.manage` | Creates draft payslips from salary structures → `{created, missing_structure[]}` |
| POST | `runs/{id}/finalize/` | `payroll.manage` | Locks the run and notifies employees. Finalized runs are immutable (409 on any change). |
| DELETE | `runs/{id}/` | `payroll.manage` | Draft only |
| GET | `payslips/` | `payroll.view_own` (own, finalized only) / `payroll.view_all` | Filters: `run`, `employee`, `run__year`, `run__month`, `run__status` |
| POST | `payslips/{id}/adjustments/` | `payroll.manage` | `{name, kind, amount}` (draft only) |
| DELETE | `payslips/{id}/adjustments/{item_id}/` | `payroll.manage` | Draft only; adjustments only |
| DELETE | `payslips/{id}/` | `payroll.manage` | Draft only |

No statutory deductions, proration or loss-of-pay are applied (not specified).

## Documents — `/api/documents/`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `` / `{id}/` | `documents.view_own` (own, visible only) / `documents.view_all` | Filters: `employee`, `category` |
| POST | `` | `documents.manage`; or self when `employee_document_upload_enabled` | Multipart `{employee, category, title, file, visible_to_employee?}`. pdf/png/jpg/jpeg/docx; magic bytes + size checked. |
| PATCH | `{id}/` | `documents.manage` | `{category, title, visible_to_employee}` |
| DELETE | `{id}/` | `documents.manage` | Deletes the file too |
| GET | `{id}/download/` | same as read | Streams as an attachment, `Cache-Control: private, no-store`. Audited. |

Categories: `OFFER_LETTER, APPOINTMENT_LETTER, CERTIFICATE, ID_DOCUMENT, PAYSLIP, EXPERIENCE_LETTER, RELIEVING_LETTER, OTHER`.

## Tasks — `/api/tasks/`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `` | — (scoped: own / team via `tasks.view_team` / all via `tasks.view_all`) | Filters: `status` (`PENDING`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, plus `OPEN` and derived `OVERDUE`), `priority`, `assigned_to`, `requires_response`, `mine`, `due_from`/`due_to`, `created_from`/`created_to`; search title / Employee ID / username / name |
| GET | `{id}/` | — (scoped) | Includes `responses[]` |
| GET | `lookup/?employee_code=` **or** `?username=` | `tasks.manage` | Confirms who an identifier refers to (exactly one identifier) |
| POST | `` | `tasks.manage` | `{employee_code` **or** `username, title, description?, priority?, due_date?, requires_response?=true}`. Stored against the internal employee id. Not to yourself. Notifies the assignee. |
| PATCH | `{id}/` | `tasks.manage` | `title, description, priority, due_date, requires_response` only (open tasks). The assignee can't be changed. |
| POST | `{id}/cancel/` `{reason?}`, `{id}/remind/` | `tasks.manage` | Open tasks only; not tasks assigned to yourself (Super Admin excepted) |
| POST | `{id}/start/`, `{id}/respond/` `{message}`, `{id}/complete/` `{message?}` | — (assignee only, else 403) | Completing a `requires_response` task needs a response first |
| GET | `blocking/` | — | Your tasks that currently block checkout: `{exempt, count, results}` |

## Messages — `/api/messages/` (`messages.use`, participants only)

| Method | Path | Notes |
|---|---|---|
| GET | `people/?q=` | Directory search by @username, Employee ID or name (minimal card, max 20) |
| GET / POST | `conversations/` | List (paginated by `page`, 30 per page) with `other`, `unread_count`, `last_message` · POST `{user_id}` gets or creates the 1:1 conversation (201 / 200) |
| GET | `conversations/{id}/` | 404 unless you are a participant |
| GET | `conversations/{id}/messages/?before=&after=` | 30 per page, oldest → newest, `has_more` |
| POST | `conversations/{id}/messages/` | Multipart `body` + up to 5 `files` (pdf, doc, docx, xls, xlsx, csv, txt, png, jpg, jpeg; content-checked) |
| POST | `conversations/{id}/read/` | Marks the conversation (and its message notifications) read |
| GET | `unread-count/` | Total unread messages |
| GET | `attachments/{id}/download/` | Private download; 404 for non-participants |

## Notifications — `/api/notifications/` (always own only)

`GET` list (filters `is_read`, `type`) · `GET unread-count/` · `GET updates/?since=<server_time>` → `{server_time, notifications[] (unread, created or refreshed after since, ≤ 20), unread_notifications, unread_messages|null}` (desktop alerts and header badges; without `since` only the counts) · `POST {id}/mark-read/` · `POST mark-all-read/`. Each notification has a `link` to the related screen.

Types: `LEAVE_SUBMITTED, LEAVE_APPROVED, LEAVE_REJECTED, LEAVE_CANCELLED, PAYSLIP_PUBLISHED, DOCUMENT_SHARED, TASK_ASSIGNED, TASK_REMINDER, TASK_RESPONSE, TASK_COMPLETED, TASK_CANCELLED, MESSAGE_RECEIVED, FILE_RECEIVED, OVERTIME_STARTED, OVERTIME_COMPLETED, SYNC_STATUS, WFH_*, OVERTIME_*, ATTENDANCE_AUTO_CHECKOUT, MEETING_SCHEDULED, MEETING_STARTED, MEETING_ENDED, MEETING_CANCELLED, RESUME_REQUESTED, RESUME_APPROVED, RESUME_REJECTED, GENERAL`.

## Reports & dashboard

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `dashboard/` | — | Role-aware: `me` (attendance today, leave balances, latest payslip, `open_tasks`, `blocking_tasks`), `pending_approvals`, `attendance_today`, `work_sessions_now` (on break / overtime running), `tasks_overview`, `unread_messages`, `headcount` / `team_size`, `latest_payroll_run`, `upcoming_holidays`, `unread_notifications` |
| GET | `reports/headcount/` | `reports.view_team` / `view_all` | By status, department, employment type |
| GET | `reports/attendance-summary/?date_from=&date_to=&department=` | same | Per employee counts. Range ≤ 93 days. |
| GET | `reports/leave-summary/?year=` | same | By type/status + approved days per employee |
| GET | `reports/payroll-summary/?run=` | `payroll.view_all` | Totals and by-department |

Add `?export=csv` to any report for a CSV download (spreadsheet-formula injection is neutralised).

## Audit log — `/api/audit-logs/`

`GET` only, `audit.view` (Super Admin). Filters: `actor`, `action` (case-insensitive), `entity_type`, `entity_id`, `date_from`, `date_to`; search on actor email/action. POST/PATCH/DELETE → 405.
