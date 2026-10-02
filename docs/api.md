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
| GET | `me/` | — | `{id, email, full_name, role{code,name,level}, permissions[], must_change_password, employee{id, employee_code, ...}|null}` |
| GET | `session/` | public | Always 200: `{authenticated, user}` where `user` has the same shape as `me` (or null). Used by the SPA on load. |
| POST | `change-password/` | — | `{current_password, new_password}` |
| POST | `password-reset/` | public, throttled | `{email}`. Always 200 (no enumeration). Emails a link to `FRONTEND_URL/reset-password?uid=&token=` |
| POST | `password-reset/confirm/` | public, throttled | `{uid, token, new_password}` |

## Users, roles, permissions

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `users/` | `users.view` | Filters: `is_active`, `role__code`; search email/name |
| POST | `users/` | `users.manage` | `{email, first_name, last_name, role, is_active, password?}`. No password → set-password email. Can only assign roles ranked below your own (Super Admin excepted). |
| GET/PATCH | `users/{id}/` | `users.view` / `users.manage` | Can't change your own role or active status. Can't edit accounts at or above your level. Users are never deleted (405). |
| GET | `roles/` | `roles.view` (or `users.manage` / `employees.manage` for the list) | Includes `permissions[]` and `user_count` |
| POST/PATCH/DELETE | `roles/{id}/` | `roles.manage` | System roles can't be deleted and their code/level can't change. Super Admin's permissions are fixed (always all). Changes are audited. |
| GET | `permissions/` | `roles.view` | Permission catalogue |

## Company & settings

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET / PATCH | `company/` | — / `company.manage` | Company profile (singleton) |
| GET / PATCH | `settings/` | — / `settings.manage` | HR policy settings. Every field is nullable/optional: empty = rule not applied. See requirements-analysis.md §3. |

`settings` fields: `timezone`, `currency`, `working_days` (list of 0=Mon…6=Sun), `work_start_time`, `work_end_time`, `late_grace_minutes`, `half_day_min_hours`, `full_day_min_hours` (both or neither), `self_attendance_enabled`, `leave_year_start_month`, `employee_document_upload_enabled`, `deactivate_user_on_exit`, `max_upload_size_mb`.

## Organisation

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `departments/`, `designations/`, `holidays/` | — | `holidays/?year=` (not paginated) |
| POST/PATCH/DELETE | `departments/{id}/` | `departments.manage` | Deleting a department in use → 409 (deactivate instead) |
| POST/PATCH/DELETE | `designations/{id}/` | `designations.manage` | Same |
| POST/PATCH/DELETE | `holidays/{id}/` | `holidays.manage` | `{date, name, is_optional}`; unique per date+name |

## Employees — `/api/employees/`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `` | — (scoped: own / team / all) | Filters: `department`, `designation`, `employment_status`, `employment_type`, `manager`; search code/name/email |
| GET | `{id}/` | — (scoped) | Confidential fields (`phone`, `address`, emergency contact, `exit_date`, `role`, `is_active`) only for yourself and `employees.view_all` |
| POST | `` | `employees.manage` | Creates the login account too: `{email, first_name, last_name, role?=EMPLOYEE, initial_password?, employee_code, joining_date, employment_type, department?, designation?, manager?, employment_status?, exit_date?, phone?, address?, emergency_contact_*}` |
| PATCH/PUT | `{id}/` | `employees.manage` | Same fields (no `initial_password`); `is_active` allowed. Escalation guards apply. `EXITED` requires `exit_date`. |
| DELETE | `{id}/` | — | 405: employees are never deleted (set `EXITED`) |
| GET/PATCH | `me/` | — | Self-service PATCH limited to `phone`, `address`, `emergency_contact_name/phone/relation` |
| GET/POST/DELETE | `{id}/photo/` | scoped; change = self or HR outranking them | Multipart `photo` (png/jpg, validated). GET streams privately. |

## Attendance — `/api/attendance/`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `` | — (scoped own/team/all) | Filters: `employee`, `status`, `is_late`, `date`, `date_from`, `date_to` |
| GET | `today/` | `attendance.self` | `{date, self_attendance_enabled, record}` |
| POST | `check-in/`, `check-out/` | `attendance.self` | 409 on a duplicate check-in / invalid check-out. 403 if self attendance is disabled. |
| GET | `daily/?date=&department=` | `attendance.view_team` / `view_all` | Per-employee status: `PRESENT`, `HALF_DAY`, `ABSENT`, `ON_LEAVE`, `HOLIDAY`, `WEEKLY_OFF`, `NOT_MARKED` |
| POST/PATCH/DELETE | `` / `{id}/` | `attendance.manage` | HR corrections: `{employee, date, check_in?, check_out?, status?, remarks?}`. Status is computed if omitted. Can't correct your own records. Audited. |

Records have `status` ∈ `PRESENT | HALF_DAY | ABSENT`, `is_late`, `worked_minutes` and `source` (`SELF | ADMIN`). Late and half-day are computed only from configured settings.

## Leave — `/api/leaves/`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `types/` | — | Not paginated |
| POST/PATCH/DELETE | `types/{id}/` | `leave.manage_types` | `{name, code, is_paid, annual_allocation?, allow_half_day, is_active}`. `annual_allocation` empty = balance not tracked. |
| GET | `balances/` | — (scoped) | Filters: `employee`, `leave_type`, `year`. Each row includes computed `used`, `pending`, `available`. |
| GET | `balances/mine/?year=` | — | Own summary for every active type |
| POST/PATCH/DELETE | `balances/{id}/` | `leave.manage_balances` | Can't change your own balance |
| POST | `balances/allocate/` | `leave.manage_balances` | `{leave_type, year, allocated?, employees?[], overwrite?}` → `{created, updated, skipped}` |
| GET | `requests/` | — (scoped) | Filters: `status`, `employee`, `leave_type`, `leave_year`, `date_from`, `date_to`. Rows include `can_decide`. |
| POST | `requests/` | `leave.apply` | Always for yourself: `{leave_type, start_date, end_date, is_half_day?, half_day_period?, reason?}`. Validates overlap, balance, working days. Notifies your manager (or HR when you have no manager). |
| GET | `requests/pending-approvals/` | `leave.approve_team` / `approve_all` | Requests you can decide |
| POST | `requests/{id}/approve/`, `reject/` | `leave.approve_team` (direct reports) / `leave.approve_all` | `{note?}`. Never your own request. Only `PENDING` (else 409). |
| POST | `requests/{id}/cancel/` | `leave.apply` (owner only) | Pending, or approved before the start date |

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

## Notifications — `/api/notifications/` (always own only)

`GET` list (filters `is_read`, `type`) · `GET unread-count/` · `POST {id}/mark-read/` · `POST mark-all-read/`

Types: `LEAVE_SUBMITTED, LEAVE_APPROVED, LEAVE_REJECTED, LEAVE_CANCELLED, PAYSLIP_PUBLISHED, DOCUMENT_SHARED, GENERAL`.

## Reports & dashboard

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `dashboard/` | — | Role-aware: `me` (attendance today, leave balances, latest payslip), `pending_approvals`, `attendance_today`, `headcount` / `team_size`, `latest_payroll_run`, `upcoming_holidays`, `unread_notifications` |
| GET | `reports/headcount/` | `reports.view_team` / `view_all` | By status, department, employment type |
| GET | `reports/attendance-summary/?date_from=&date_to=&department=` | same | Per employee counts. Range ≤ 93 days. |
| GET | `reports/leave-summary/?year=` | same | By type/status + approved days per employee |
| GET | `reports/payroll-summary/?run=` | `payroll.view_all` | Totals and by-department |

Add `?export=csv` to any report for a CSV download (spreadsheet-formula injection is neutralised).

## Audit log — `/api/audit-logs/`

`GET` only, `audit.view` (Super Admin). Filters: `actor`, `action` (case-insensitive), `entity_type`, `entity_id`, `date_from`, `date_to`; search on actor email/action. POST/PATCH/DELETE → 405.
