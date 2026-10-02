# Testing

| Layer | Tool | Location | Runs against |
|---|---|---|---|
| Backend unit/API | pytest + pytest-django | `backend/apps/*/tests/` | Real PostgreSQL (test database `test_nexvra_hrms`, created automatically) |
| Frontend unit | Vitest | `frontend/src/**/*.test.ts` | Node |
| End-to-end | Playwright | `tests/e2e/api` (HTTP) and `tests/e2e/ui` (Chromium) | Live backend + frontend seeded with `seed_demo` |

## Backend

```bash
cd backend
.venv/Scripts/python -m pytest              # all tests (--reuse-db is on by default)
.venv/Scripts/python -m pytest --create-db  # after migration changes
.venv/Scripts/python -m pytest apps/leaves -k approve
.venv/Scripts/python -m pytest --cov=apps --cov-report=term-missing
.venv/Scripts/ruff check .
```

Shared fixtures (`backend/conftest.py`) build a small organisation: `super_admin`, `hr`, `manager` (with direct reports `alice` and `bob`), and `other_manager` (with `carol`). Uploads go to a temporary directory, and passwords use a fast hasher in tests only.

What the suite covers:

| Area | File | Highlights |
|---|---|---|
| Authentication | `accounts/tests/test_auth.py` | Login/logout, case-insensitive email, generic errors, inactive users, session invalidation, CSRF on login and unsafe requests, throttling, change/reset password (single-use token, no enumeration), error envelope |
| RBAC & escalation | `accounts/tests/test_rbac.py` | Role matrix, admin endpoints blocked for HR/manager/employee, role-permission editing, Super Admin immutability, HR can't create or promote to HR/Super Admin, can't edit Super Admin, no self role change |
| Employees | `employees/tests/test_employees.py` | HR CRUD, uniqueness, reporting cycles, exit rules, **employee isolation**, **manager limited to team**, confidential-field filtering, self-service limits, private photo upload/validation |
| Attendance | `attendance/tests/test_attendance.py` | Check-in/out, conflicts, late and half-day only when configured, company time zone, disabled self attendance, scoping, HR corrections (audited, not on self), daily status |
| Leave | `leaves/tests/test_leaves.py` | Day counting (with/without working days, holidays), half days, balances, overlaps, leave-year span, manager/HR approval, no self-approval, outside-team 404, cancel rules, notifications, bulk allocation |
| Payroll | `payroll/tests/test_payroll.py` | Structures, effective dates, generation, totals, adjustments, finalize lock, employee sees only own finalized payslips, manager has no payroll access, no self-salary edits |
| Documents | `documents/tests/test_documents.py` | Upload/download, randomised storage names, hidden docs, cross-employee/manager 404, malicious and oversized files, employee-upload setting |
| Organisation | `organization/tests/test_organization.py` | Settings start empty, validation, who may edit, department protection, holidays |
| Notifications | `notifications/tests/test_notifications.py` | Own-only access, read state |
| Audit | `audit/tests/test_audit.py` | Super Admin only, read-only, IP/user agent, password redaction, filters |
| Reports | `reports/tests/test_reports.py` | Scoped headcount, attendance summary maths, CSV formula-injection guard, role-aware dashboard |

## Frontend

```bash
cd frontend
npm test            # vitest: API client (CSRF header, errors, params), formatting, role-aware navigation
npm run typecheck
npm run build
```

## End-to-end (Playwright)

Two projects:

- **api**: critical flows over HTTP with real sessions and CSRF. Covers login per role, logout and CSRF refusal; HR creates an employee → employee checks in → leave request → manager approval → payroll → own payslip only; and unauthorised access (employee ↔ other employee, manager ↔ outside team, HR ↔ system administration, employee ↔ admin endpoints).
- **ui**: the same journeys through the real screens in Chromium:
  - unauthenticated redirect to login; wrong-password error; role-aware navigation
  - employee opening admin pages sees "no access" (and the API returns 403); manager sees only their team
  - HR creates an employee through the form; a duplicate employee ID shows a field error
  - the new employee is forced to change password, then checks in
  - the employee applies for leave, the manager approves it in the Approvals tab, and the employee sees "Approved" and a notification
  - after payroll is finalized, the employee opens their own payslip
  - HR uploads a document through the UI and the employee downloads the identical file (exercises multipart upload and streamed download through the proxy)

Recommended: run the e2e suite against a **separate e2e database and ports**, so your demo data and running app stay untouched.

```bash
# once: create and seed the e2e database
psql -U postgres -c "CREATE DATABASE nexvra_hrms_e2e OWNER nexvra;"
cd backend
DATABASE_URL=postgres://nexvra:<pw>@localhost:5432/nexvra_hrms_e2e .venv/Scripts/python manage.py migrate
DATABASE_URL=postgres://nexvra:<pw>@localhost:5432/nexvra_hrms_e2e .venv/Scripts/python manage.py seed_demo --password "<demo-password>"

# terminal 1: e2e backend on :8001 (e2e logs in many times, so raise the login throttle)
DATABASE_URL=postgres://nexvra:<pw>@localhost:5432/nexvra_hrms_e2e THROTTLE_LOGIN=1000/min \
  DJANGO_CSRF_TRUSTED_ORIGINS=http://127.0.0.1:3002,http://localhost:3002 \
  .venv/Scripts/python manage.py runserver 127.0.0.1:8001

# terminal 2: e2e frontend on :3002 pointing at it
cd frontend
npm run build && BACKEND_URL=http://127.0.0.1:8001 npx next start -p 3002

# terminal 3
cd tests/e2e
npm install
npx playwright install chromium     # first time only
E2E_BASE_URL=http://127.0.0.1:8001 E2E_UI_URL=http://127.0.0.1:3002 E2E_PASSWORD="<demo-password>" npx playwright test
# defaults are :8000 / :3000 if you prefer to test against the normal servers (needs THROTTLE_LOGIN raised)
```

The flow tests create uniquely named `e2e-*` / `ui-*@example.test` employees and payroll runs in unused far-future months, so they can be re-run safely. They do leave that test data in the dev database. To get a clean demo database back, drop and recreate it, then run `migrate` and `seed_demo`.

### What the new-feature tests cover

| Layer | Files | Covers |
|---|---|---|
| Backend | `apps/attendance/tests/test_work_sessions.py` | breaks (flow, multiple, duplicates, overlap, invalid states, close at checkout, scope), overtime (flow, duplicates, overlap, separation from attendance, visibility per role, all roles), task checkout protection (blocking, response unblocks, closed tasks don't block, HR/Manager blocked, Super Admin exempt, API bypass), offline sync (device times, ordering, idempotent retry, conflicts, rejections, per-user ids, recovery state) |
| | `apps/tasks/tests/test_tasks.py` | assignment by Employee ID / username, rename-safe relationship, invalid / exited / self assignee, notifications, visibility per role, start/respond/complete, ownership can't change, edit/remind/cancel, derived OVERDUE |
| | `apps/messaging/tests/test_messaging.py` | directory search, 1:1 conversations, unread + read, collapsed notifications, pagination, participant-only access (incl. HR/Super Admin), valid & invalid attachments (magic bytes, fake OOXML, binary CSV), random storage names, download by guessing ids |
| | `apps/leaves/tests/test_leave_lock_and_balance.py` | pending/rejected/cancelled don't reduce the balance, approval deducts once with audit, duplicate approval, **real concurrent approvals (threads)**, approved can't be cancelled, never negative, allocation floor, ledger scope |
| | `apps/accounts/tests/test_usernames.py`, `apps/core/tests/test_files.py`, `apps/reports/tests/test_dashboard_sessions.py` | usernames, file validation, dashboard + notification links |
| Frontend | `lib/worksession.test.ts`, `lib/offline.test.ts` | break/overtime timers, actual working time, offline overlay, queue persistence, idempotent enqueue, sync, retry back-off |
| | `components/attendance/WorkSessionCard.test.tsx` | break timer, overtime timer, checkout popup, server-side block, offline queue + reconnect sync, offline snapshot, session recovery |
| | `components/tasks/AssignTaskModal.test.tsx`, `components/connection/ConnectionIndicator.test.tsx`, `components/leave/LeaveLock.test.tsx`, `app/(app)/messages/messages.test.tsx`, `app/(app)/notifications/notifications.test.tsx` | lookup by ID / username, offline indicator + sync status, leave lock + balance display, messaging + file upload, task notification |
| E2E | `api/new-features.spec.ts` | API-level rules for every role (no UI) |
| | `ui/work-session.spec.ts`, `ui/overtime-leave.spec.ts`, `ui/messaging-offline.spec.ts`, `ui/roles-new-features.spec.ts`, `ui/page-health.spec.ts` | the full browser flows, role visibility, every page × 4 roles without console/5xx errors, phone-width layout |

New E2E flows create their own uniquely named employees through the HR API, so they can run any number of times per day.

## Latest results (2026-10-02)

| Suite | Result |
|---|---|
| Backend pytest (PostgreSQL 16) | 219 passed |
| Frontend Vitest (unit + component, jsdom) | 58 passed; `tsc` clean; `next build` OK (25 routes) |
| Playwright e2e (isolated e2e DB, :8001/:3002) | 45 passed (18 api + 27 ui) |
| `makemigrations --check` | no missing migrations |
| Backend-down check | login page shows "Can't reach the Nexvra HRMS server"; one log line, no stack traces |
| Browser tour: every screen for all 4 roles (automated: `ui/page-health.spec.ts`) | no console errors, no 5xx responses; no horizontal scroll at 390 px |
| `ruff check` | clean |
| `manage.py check --deploy` (production settings) | no issues |
