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
  - the new employee signs in with the initial password straight to the dashboard, checks in, then changes password voluntarily
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
| Backend | `apps/organization/tests/test_policies.py` | policy visibility per role (drafts hidden, 404 by id), search + category filter, only `policies.manage` can change, validation, case-insensitive unique titles, audit without policy text, break-allowance validation and the over-allowance figure |
| Frontend | `app/(app)/policies/policies.test.tsx`, `components/attendance/WorkSessionCard.test.tsx` | employee view (rules from Settings, no editing), HR publishing with server validation errors, break allowance hint |
| Backend | `apps/attendance/tests/test_attendance_rules.py` | geofence (5 / 19 / 19.99 m allowed, boundary rule, 21 / 100 m refused, forged flags, missing / imprecise / impossible coordinates, no workplace = rule off, coordinates never returned), geofence exit (jitter ignored, single audited check-out, permission denied recorded not treated as leaving, not during breaks), WFH (pending / rejected / expired / another person's approval refused, approved WFH check-in without location, decision rules, scope, notifications + email), break allowance (15+20+25=60 then refused, running break closed at the limit, late end capped, refresh, logout, end after auto-close, auto check-out during a break), inactivity (activity resets, 29:59 vs 30:00, single check-out across heartbeat / refresh / scheduled job, lost connection, no backdating, manual action after overdue inactivity), overtime (each declaration rule, own open tasks only, request → approve → start → end with audit trail, rejection, 30-minute auto-stop and no silent restart, approval-off mode, expiry, offline start needs approval), SMTP failure logged without secrets and the action still succeeds |
| | `apps/core/tests/test_backups_and_settings.py` | backup retention, zip verification, unsafe archive paths, damaged / incomplete sets refused, failed backup reported and cleaned up, a real pg_dump backup verified and restored; production / staging settings guards |
| Frontend | `components/attendance/WorkSessionCard.test.tsx` (shared provider), `lib/activity.test.ts`, `components/layout/ThemeToggle.test.tsx` | header + card actions per state, break used / remaining and "Break unavailable", overtime declaration validation and payload, approved overtime start, geofenced check-in (outside disabled with distance, inside sends raw coordinates only, permission blocked), WFH check-in without location, automatic check-out notice, activity tracker privacy and jitter rules, geofence display rule, theme persistence and no-flash boot script |
| E2E | `ui/attendance-rules.spec.ts` | geofence with simulated GPS (outside disabled, forged API call refused, inside check-in, automatic check-out on leaving), WFH request → HR approval → WFH check-in, break allowance in real time, activity reports cannot fake inactivity, HR / Super Admin-only decisions, theme persistence, phone-width attendance menu |
| E2E | `api/new-features.spec.ts` | API-level rules for every role (no UI) |
| | `ui/work-session.spec.ts`, `ui/overtime-leave.spec.ts`, `ui/messaging-offline.spec.ts`, `ui/roles-new-features.spec.ts`, `ui/policies.spec.ts`, `ui/page-health.spec.ts` (flows use the card's action row, since the same actions are also in the header) | the full browser flows, role visibility, every page × 4 roles without console/5xx errors, phone-width layout |
| Backend | `apps/attendance/tests/test_meetings_resume.py` | overall meeting pause and automatic resume (9-11 work, 11-12 meeting, worked 3 h of 9-13), no inactivity check-out during a meeting, inactivity clock restarts at the meeting end, running break closed at meeting start + breaks refused during it, check-in during a meeting starts paused, check-out during a meeting, no geofence exit during a meeting, selected meeting pauses only participants (non-participant checked out for inactivity meanwhile), participants changed while running, invalid overlaps refused, cancel, planned end time, permissions + visibility; Resume Work full flow (normal check-in refused, pending, approval does not check in, re-check-in reopens the session, non-working 90 min, break allowance untouched, worked 370 min), rejection keeps the employee out, geofence and WFH validation on the resumed check-in, rules (only after inactivity, one open request, HR/SA only, not own, expiry), cancel; activity evidence (continuous activity never times out, offline activity prevents a check-out, a 30-minute gap inside a report, reopening a closed browser cannot back-fill, silent browser settled after the grace at the deadline, payload validation, no second check-out after an inactivity check-out), duplicate check-in / invalid check-out, the four time categories in the payload |
| | `apps/notifications/tests/test_notifications.py` | `updates/` poll: only new unread items after the cursor, never twice, counts for the header, refreshed collapsed message alerts resurface |
| Frontend | `lib/activity.test.ts`, `lib/worksession.test.ts`, `lib/linkify.test.tsx`, `lib/notifications.test.ts` | activity signals (input, wheel, focus, touch), moments kept until acknowledged, 40-minute outage reported later, new observation window after a meeting, sharing between tabs, one heartbeat per browser, device-wide detection restored after reload only when allowed; meeting pause / non-working / break separation and Resume Work states; link detection, unsafe schemes and credentials, markup rendered as text; desktop alert planning (foreground toast vs background popup, permission granted / denied / unsupported, once per item across tabs, burst summary, Messages page), popup tag + default sound + click |
| | `components/attendance/MeetingResume.test.tsx`, `components/layout/NotificationCenter.test.tsx`, `app/(app)/dashboard/dashboard.test.tsx` | Resume Work instead of Check in, reason submitted, waiting / approved / rejected states, approval does not check in; meeting banner, no break, no heartbeat during a meeting; heartbeat body has activity metadata only; header counts + one alert per item in the background, permission request from a click; dashboard figures with three distinct colours and the auto-fit row |
| E2E | `api/meetings-resume.spec.ts`, `ui/meetings-links-dashboard.spec.ts` | selected meeting over HTTP (participant paused, non-participant works, session continues, visibility), role limits, Resume Work refused outside an inactivity check-out, heartbeat payload validation; HR runs a meeting from the Meetings page and the participant sees working time paused; clickable message links with markup shown as text (no script runs); dashboard cards in one row at 1600 px, one per row at 420 px, three distinct colours in light and dark |

New E2E flows create their own uniquely named employees through the HR API, so they can run any number of times per day.

## Latest results (2026-10-05, release 4: meetings, Resume Work, activity detection, desktop alerts)

| Suite | Result |
|---|---|
| Backend pytest (PostgreSQL 16) | 324 passed (294 before this release + 30 new) |
| Frontend Vitest (unit + component, jsdom) | 126 passed (83 + 43 new); `tsc` clean; `next build` OK (27 routes) |
| Playwright e2e (isolated e2e DB, :8001/:3002) | 65 tests (22 api + 43 ui). Every test passed, but not in one clean run: on this 7.7 GB PC the full run (56 min) had 46 passed, 15 failed (timeouts: password hashing takes 2–5 s per hash here, and logins stalled past 10–30 s while two app servers, two test servers and Chromium competed for memory), 4 not run. Re-running the failures: 15 of 19 passed; then the remaining specs passed after fixing two of the new tests (a duplicate text match, a wrong phone-layout assumption) and giving three hashing-bound assertions in `ui/flows.spec.ts` the same 30 s the login helper already allows. One product fix came out of the review between runs (no second check-out after an inactivity check-out inside a heartbeat; backend regression test added). |
| `makemigrations --check` / `manage.py check` | no missing migrations / no issues |
| `ruff check` | clean |
| `bandit -r apps config` | 0 issues |
| `npm audit --omit=dev` | 0 vulnerabilities |

## Previous results (2026-10-04, release 3: attendance rules + production hardening)

| Suite | Result |
|---|---|
| Backend pytest (PostgreSQL 16) | 293 passed |
| Frontend Vitest (unit + component, jsdom) | 83 passed; `tsc` clean (with `noUnusedLocals`/`noUnusedParameters`); `next build` OK (26 routes, no warnings) |
| Playwright e2e (isolated e2e DB, :8001/:3002) | 58 tests (18 api + 40 ui). Full run: 52 passed, 6 failed; all 6 passed on re-run after fixing test-only issues (a toast regex that matched a hidden `<option>`, an old hint text) and raising timeouts for a heavily loaded machine (logins took up to 20 s). No product code changed between the runs. |
| `makemigrations --check` | no missing migrations |
| Backend-down check | login page shows "Can't reach the Nexvra HRMS server"; one log line, no stack traces |
| Browser tour: every screen for all 4 roles (automated: `ui/page-health.spec.ts`) | no console errors, no 5xx responses; no horizontal scroll at 390 px |
| `ruff check` | clean |
| `bandit -r apps config` | 0 issues (reviewed low-severity findings are annotated `# nosec` with the reason) |
| `pip-audit -r requirements.txt` | no known vulnerabilities (after upgrading Django REST framework to 3.17.2) |
| `npm audit` | 0 vulnerabilities (PostCSS inside Next.js pinned to the project version via `overrides`) |
| `manage.py check --deploy` (production settings) | only `security.W021`: HSTS preload is deliberately opt-in (`SECURE_HSTS_PRELOAD=True`), because it is hard to undo |
