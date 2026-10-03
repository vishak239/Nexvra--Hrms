# Architecture

## 0. Overview

```
Browser ──► Next.js (frontend, :3000) ──rewrite /api/* ──► Django + DRF (backend, :8000) ──► PostgreSQL
                │                                              │
                └─ /brand/* (copied from /brand)               └─ private media dir (documents, photos, message files), never served publicly
```

- **One origin for the browser.** Next.js proxies `/api/*` to Django, so the session cookie is first-party and CORS isn't needed in normal use. CORS is still configurable through env for split-domain deployments.
- **Stateless frontend, authoritative backend.** Every authorization decision is made by Django. The frontend reads `GET /api/auth/me/` (role + permission codes) only to decide what to *display*.
- **Single company.** This is an internal HRMS for Nexvra Solutions, so `Company` and `CompanySettings` are singletons and there are no tenant foreign keys.

## 1. Frontend architecture

**Status: implemented; re-skinned to the official Stitch design (2026-10-03).** The design source of truth is `stitch_nexvra_hrms_enterprise_platform/` ("Obsidian Kinetic"). How it is applied:

- **Tokens:** the Stitch Tailwind config (colours such as `surface-container-*`, `primary-container` = lime, `on-surface-variant`; radius; spacing; the `headline-*` / `label-*` / `data-metric` type scale) is copied verbatim into `tailwind.config.ts`. The only addition is `warning*` (amber), taken from DESIGN.md.
- **Fonts:** Space Grotesk (headings, metrics) and Inter (body, tabular numbers), self-hosted via `@fontsource-variable/*`, so no external font requests.
- **Icons:** Material Symbols Outlined (the Stitch icon set), generated into `src/components/ui/icons.tsx` by `scripts/build-icons.mjs` (inline SVG, offline).
- **Components:** Button, Field, Card/PageHeader/Badge/StatCard, Table/Pagination, Modal/Tabs/Toasts and the AppShell reproduce the Stitch treatments; pages use only these and the tokens. `scripts/stitch-codemod.py --check` reports any leftover legacy colour class.
- **Print:** a print stylesheet turns every surface into black-on-white (the payslip letterhead keeps its own colours).

Structure:

```
src/app/(auth)/          login, forgot-password, reset-password (split layout with the logo panel)
src/app/(app)/           authenticated screens inside AppShell (sidebar + top bar)
  dashboard, profile, change-password, employees[/new|/[id]|/[id]/edit], attendance, leave,
  holidays, policies, tasks, messages, payslips[/[id]], documents, notifications, payroll[/runs/[id]],
  reports, settings, admin/users, admin/audit
src/components/ui/       Button, Field controls, Card/Badge/StatCard, Table/Pagination, Modal (portal),
                         ConfirmDialog, Tabs, Toasts, Loading/Empty/Error/NoAccess states
src/components/layout/   AppShell (auth guard, forced password change, permission-driven navigation)
src/components/attendance/  WorkSessionCard (check-in/out, breaks, overtime, checkout task popup, recovery)
src/components/connection/  ConnectionIndicator (ONLINE / OFFLINE / SYNCING / SYNCED / SYNC ERROR)
src/components/tasks/, leave/  AssignTaskModal (lookup by Employee ID or @username), leave lock + balance
src/lib/                 api client, auth context, useResource/useAction hooks, formatting, nav config,
                         worksession.ts (timer maths), offline.ts (per-user sync queue), connection.tsx
```

- Every data view has loading (skeleton), empty and error states. A 403 from the API renders a "no access" state.
- Navigation and action buttons are shown or hidden from `me.permissions` (display only). The API enforces every rule independently.
- Forms show the backend's field-level validation errors next to each field.
- Modals render through a React portal, close on Escape, and restore focus.
- The payslip page has a print stylesheet (Print / Save as PDF).
- Work-session timers are derived from server timestamps plus the measured server-clock offset, never from counting ticks, so they stay correct in background tabs. Offline break/overtime actions go into a per-user localStorage queue with a client UUID and are replayed to `POST /api/attendance/sync/` when the connection returns. Details: [work-sessions-tasks-messaging.md](work-sessions-tasks-messaging.md).

- Next.js 15 (App Router) + TypeScript 5 + Tailwind CSS **3.4**. Stitch exports Tailwind HTML with a v3-style `tailwind.config`, so v3 lets screens and tokens port almost 1:1.
- Route groups: `(auth)` for login, forgot and reset; `(app)` for the authenticated shell (sidebar + top nav).
- `src/app/api/[...path]/route.ts` (using `src/lib/proxy.ts`) forwards every `/api/*` request to Django (`BACKEND_URL`), including cookies, CSRF header, multipart uploads and streamed downloads. If Django is unreachable it returns a JSON `503 backend_unavailable` (or `504 backend_timeout`) and logs a single hint line, never a stack trace per request. The UI shows "Can't reach the server". A route handler is used instead of a `next.config` rewrite because rewrites can't handle connection failures.
- `src/lib/api.ts` is a typed fetch wrapper. It sends `credentials: "include"` and the `X-CSRFToken` header, and normalises the error envelope.
- `src/lib/auth.tsx` provides `useAuth()` (current user, role, permissions, login/logout) and `<Can perm="...">` for display-only gating. It reads `GET /api/auth/session/`, which always returns 200, so a logged-out visitor isn't a console error.
- `src/middleware.ts` redirects to `/login` when there's no session cookie. This is a UX convenience only; the backend still enforces everything.
- `src/components/brand/NexvraLogo.tsx` is the **only** place the logo is rendered: `/brand/nexvra-logo.svg`, unmodified. Its built-in black background means it's placed only on dark surfaces.
- Every data view has loading, empty and error states.

## 2. Backend architecture

Django 5.2 LTS + Django REST Framework. Each app follows the same layout:

```
apps/<app>/
  models.py        data + DB constraints
  serializers.py   input validation + output shaping (role-aware where needed)
  services.py      business rules (transactions, calculations, notifications, audit)
  views.py         thin DRF views: auth → permission → scope queryset → serializer → service
  urls.py
  admin.py
  tests/
```

| App | Responsibility |
|---|---|
| `core` | `TimeStampedModel`, `HasPermission` permission class, scoping helpers, pagination, exception handler, file validators |
| `accounts` | Custom `User` (email login), `Role`, `Permission`, auth endpoints, users & roles APIs, role seed migration |
| `organization` | `Company`, `CompanySettings` (incl. daily break allowance), `Department`, `Designation`, `Holiday`, `Policy` (HR-written company policies) |
| `employees` | `Employee` + role-aware serializers, photo endpoint |
| `attendance` | `AttendanceRecord`, check-in/out, status computation; `BreakSession`, `OvertimeSession`, `SyncEvent` and the offline sync service (`sessions.py`) |
| `leaves` | `LeaveType`, `LeaveBalance`, `LeaveRequest`, day counting, approvals, approval lock, `LeaveBalanceTransaction` ledger (deduct once on approval) |
| `payroll` | `PayComponent`, `SalaryStructure(+Item)`, `PayrollRun`, `Payslip(+Item)` |
| `documents` | `EmployeeDocument`, private storage, streaming download |
| `tasks` | `Task`, `TaskResponse`, assignment by Employee ID or @username, checkout-blocking rule (`rules.py`) |
| `messaging` | `Conversation`, `Message`, `MessageAttachment`, people directory, participant-only access, private attachment storage |
| `notifications` | `Notification` + `notify()` service |
| `audit` | `AuditLog` + `audit.record()` service |
| `reports` | Report queries, CSV export, `/api/dashboard/` |

**Rule:** views never contain business logic beyond orchestration. Rules such as "approve leave → check balance → set status → notify → audit" live in `services.py` inside `transaction.atomic()`.

## 3. Database architecture

PostgreSQL 16, accessed only through the Django ORM. Every schema change goes through a migration. Full entity list and constraints: `docs/database.md`.

Principles:
- Normalised. Name/email live on `User` only; used/pending leave is computed, not stored.
- Deliberate snapshots only where history must not change: `LeaveRequest.days` (holiday calendar may change later), `PayslipItem` name/amount (salary structure may change later), `AuditLog.actor_email`.
- Integrity at the DB level: `UniqueConstraint` (employee code, case-insensitive email, one attendance row per employee/day, one payroll run per month, one balance per employee/type/year), `CheckConstraint` (end ≥ start, check_out ≥ check_in, amounts ≥ 0), `PROTECT` on foreign keys to reference data.
- Indexes on every FK plus common filters (date, status, created_at).

## 4. Authentication

- **Strategy:** Django session authentication with an HttpOnly, SameSite=Lax cookie, plus CSRF double-submit (`csrftoken` cookie + `X-CSRFToken` header). This was chosen over JWT for a first-party browser app because it allows server-side revocation (logout, deactivation), keeps tokens away from JS, and needs no custom token storage.
- Login with email + password (case-insensitive email). Passwords are hashed with Django's PBKDF2 hasher.
- Session key is rotated on login. Logout flushes the session.
- Inactive users can't log in, and their existing sessions stop resolving (`ModelBackend.get_user` checks `is_active`).
- Throttling: `login` and `password_reset` scopes (rates configurable through env).
- Password reset: Django `PasswordResetTokenGenerator` (signed, single-use, expires after `PASSWORD_RESET_TIMEOUT`). The request endpoint always returns 200 so emails can't be enumerated.
- New employees: HR may set an initial password (the user must change it at first login) or leave it empty. In that case the account gets an unusable password and a set-password email.

## 5. Authorization (RBAC + object scope)

**Model:** `User` → `Role` (one per user) → many `Permission` (codename strings). There are 4 system roles, seeded by migration, each with a `level` used for escalation checks.

**Permission catalogue:**

| Area | Codenames |
|---|---|
| Company/settings | `company.manage`, `settings.manage` |
| Users/roles/audit | `users.view`, `users.manage`, `roles.view`, `roles.manage`, `audit.view` |
| Org data | `departments.manage`, `designations.manage`, `holidays.manage` |
| Employees | `employees.view_team`, `employees.view_all`, `employees.manage` |
| Attendance | `attendance.self`, `attendance.view_team`, `attendance.view_all`, `attendance.manage` |
| Leave | `leave.apply`, `leave.view_team`, `leave.approve_team`, `leave.view_all`, `leave.approve_all`, `leave.manage_types`, `leave.manage_balances` |
| Payroll | `payroll.view_own`, `payroll.view_all`, `payroll.manage` |
| Documents | `documents.view_own`, `documents.view_all`, `documents.manage` |
| Reports | `reports.view_team`, `reports.view_all` |
| Tasks | `tasks.view_team`, `tasks.view_all`, `tasks.manage` |
| Messages | `messages.use` |
| Policies | `policies.manage` (reading published policies needs no permission) |

**Default role matrix** (editable by SUPER_ADMIN, except that SUPER_ADMIN always keeps everything):

| Role (level) | Permissions |
|---|---|
| EMPLOYEE (10) | `attendance.self`, `leave.apply`, `payroll.view_own`, `documents.view_own`, `messages.use` |
| MANAGER (20) | EMPLOYEE + `employees.view_team`, `attendance.view_team`, `leave.view_team`, `leave.approve_team`, `reports.view_team`, `tasks.view_team` |
| HR_ADMIN (50) | MANAGER + `employees.view_all`, `employees.manage`, `attendance.view_all`, `attendance.manage`, `leave.view_all`, `leave.approve_all`, `leave.manage_types`, `leave.manage_balances`, `holidays.manage`, `departments.manage`, `designations.manage`, `payroll.view_all`, `payroll.manage`, `documents.view_all`, `documents.manage`, `reports.view_all`, `settings.manage`, `tasks.view_all`, `tasks.manage`, `policies.manage` |
| SUPER_ADMIN (100) | Everything, including `company.manage`, `users.*`, `roles.*`, `audit.view` |

**Enforcement layers:**
1. `HasPermission`: a DRF permission class. Views declare `required_permissions` per action. A missing permission returns 403.
2. **Queryset scoping:** list/detail querysets are filtered by `scope(user, area)` → `all` | `team` | `own`. An object outside scope returns **404**, not 403, so other records' existence isn't leaked.
3. **Field-level:** the serializer is chosen by the viewer's relationship to the record (self / manager / HR).
4. **Escalation guards:** a user can't change their own role, and can assign or edit only roles and users with a *lower* `level` than their own (SUPER_ADMIN excepted). Only SUPER_ADMIN can edit role permissions.
5. **Business guards:** nobody approves their own leave; approved leave can't be cancelled by the applicant; finalized payroll is immutable; employees see only finalized payslips and documents marked visible; check-out is refused (409 `checkout_blocked_by_tasks`) while a blocking task is unanswered, except for Super Admin.
6. **Conflict-of-interest guards:** apart from Super Admin, nobody can correct their own attendance, change their own leave balance, or set their own salary/payslip adjustments.
7. **Self-service:** every employee can edit only their own contact fields (phone, address, emergency contact) through `/api/employees/me/`.
8. **Participant-only messaging:** conversation, message and attachment querysets are filtered to the requesting user's own conversations. No role (including Super Admin) can read other people's messages; any other id returns 404.
9. **Server-resolved identities:** the task assignee, task owner, conversation participants, durations and leave balances are always resolved or computed on the server. Values sent by the browser for these are ignored.

"Team" means **direct reports** (`Employee.manager = me`) in V1.

## 6. API architecture

- REST under `/api/` with resource paths as in the brief (`/api/employees/`, `/api/leaves/requests/`, ...). Full reference: `docs/api.md`.
- JSON only (multipart for uploads). Paginated lists: `{count, next, previous, results}`; `?page=`, `?page_size=` (max 100).
- Filtering through query params (`?status=`, `?employee=`, `?date_from=`), plus search and ordering where useful.
- Decimals (money, leave days) are always serialised as strings.
- Methods a resource doesn't support return 405, even for users without permissions (authentication is still required).
- Workflow transitions are explicit action endpoints (`POST .../approve/`), not generic PATCHes of `status`.
- OpenAPI schema at `/api/schema/` (drf-spectacular); Swagger UI at `/api/docs/` when `DEBUG` is on.

## 7. File / document handling

- Stored under `PRIVATE_MEDIA_ROOT` (outside any static/public directory) with randomised names (`documents/<uuid>.<ext>`). The original filename is kept only as metadata.
- **No public media URL** is configured. Files are returned only through `GET /api/documents/{id}/download/` or `/api/employees/{id}/photo/`, after the same permission + scope checks. Responses send `Content-Disposition: attachment` (inline for photos), `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`.
- Validation: extension allowlist (pdf, png, jpg, jpeg, docx), magic-byte check, size limit (`max_upload_size_mb`).
- Production can switch to S3-compatible private storage through Django storages without code changes in views.
- **Message attachments** reuse the same validators and storage principles: allowlist (pdf, doc, docx, xls, xlsx, csv, txt, png, jpg, jpeg), magic-byte check, real Office packages for docx/xlsx, text-only csv/txt, the same size limit, random names under `message_files/`, and download only through `GET /api/messages/attachments/{id}/download/` after the participant check.

## 8. Audit logging

- `audit.record(request, action, obj=None, changes=None, metadata=None)` is called from services.
- Records: actor (FK, plus an email snapshot so history survives user deletion), action, entity type, entity id, changes (`{field: [old, new]}` with sensitive fields redacted), metadata, IP (`REMOTE_ADDR`, or `X-Forwarded-For` only when `TRUST_X_FORWARDED_FOR` is set), user agent, timestamp.
- Audited actions: login success/failure, logout, password change/reset, user/role changes, employee create/update/deactivate, attendance corrections, leave submit/approve/reject/cancel, leave type/balance changes, leave balance deductions (`LEAVE_BALANCE_DEDUCTED`), task create/update/start/respond/complete/cancel/remind, break start/end, overtime start/complete, offline sync conflicts and rejections, salary changes, payroll generate/finalize, document upload/download/delete, settings/company changes.
- Append-only: there's no update/delete endpoint, and the Django admin is read-only.
- Private message contents and file contents are never written to the audit log.

## 9. Error handling

A single envelope comes from a custom DRF exception handler:

```json
{ "error": { "code": "validation_error", "message": "Invalid input.", "fields": { "end_date": ["..."] } } }
```

Codes: `validation_error` (400), `not_authenticated` (401/403 when no session), `permission_denied` (403), `not_found` (404), `conflict` (409, e.g. duplicate check-in), `throttled` (429), `server_error` (500, generic message; details only in server logs).

## 10. Validation

- Serializers handle shape/type and cross-field checks.
- Services enforce business rules (balances, overlaps, state machine transitions) and raise `ValidationError` / `Conflict`.
- DB constraints are the last line of defence.

## 11. Testing

- **Backend:** pytest + pytest-django against PostgreSQL (the same engine as production). Per-app `tests/` folders. Fixtures create users per role. The **isolation suite** explicitly covers: employee accessing another employee, manager outside their team, HR attempting system administration, normal users hitting admin endpoints.
- **Frontend:** unit and component tests (Vitest + Testing Library, jsdom) for the API client, proxy, timers, offline queue, work-session card, task assignment, connection indicator, leave lock, messaging and notifications.
- **E2E:** Playwright in `tests/e2e/`. Covers login, employee create/view, attendance, breaks, overtime, task checkout protection, leave approval lock and balance, messaging with files, offline sync, role visibility, and a page-health sweep of every page for all four roles.
- Details: `docs/testing.md`.

## 12. Environment configuration

All configuration comes from environment variables (`backend/.env`, `frontend/.env.local`). Root `.env.example` documents every variable with placeholders only. Required in production: `DJANGO_SECRET_KEY`, `DATABASE_URL`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`. Settings refuse to start with `DEBUG=False` and a missing or default secret key.

## 13. Deployment considerations

- Backend: gunicorn (WSGI) behind a reverse proxy (nginx/Caddy) with TLS. Frontend: `next build && next start` (or a standalone output) behind the same proxy.
- With `DEBUG=False`: secure + HttpOnly cookies, HSTS, `SECURE_SSL_REDIRECT`, `SECURE_PROXY_SSL_HEADER` behind the proxy, and `collectstatic` for admin assets.
- Run `python manage.py migrate` on each deploy. Seed roles via migration; seed demo data **only** in non-production (`seed_demo` refuses to run when `DEBUG=False`).
- Back up PostgreSQL and the private media directory.
- Docker compose can be added later. Docker isn't installed on the dev machine, so it isn't required for V1.

## 14. Security considerations

| Threat | Mitigation |
|---|---|
| Broken access control / IDOR | Permission class + scoped querysets (404) on every endpoint, with explicit isolation tests |
| Privilege escalation | Role level guards; no self-role change; only SUPER_ADMIN edits role permissions |
| CSRF | DRF SessionAuthentication enforces CSRF; SameSite=Lax cookies |
| XSS stealing tokens | No tokens in JS; HttpOnly session cookie; React escapes output |
| Brute force | Login throttling + audit of failures |
| Account enumeration | Generic login error; password reset always returns 200 |
| SQL injection | ORM only; no raw SQL |
| Malicious uploads | Allowlist + magic bytes + size limit; random names; never executed or served inline (except validated images); same rules for message attachments |
| Reading other people's messages or files | Participant-only querysets (404); no admin read path; ids are not guessable into access |
| Double leave deduction (double click, retry, concurrency) | Row locks + one-to-one ledger row per request + non-negative check constraint, all in one transaction |
| Replayed or duplicated offline events | Unique `(user, client_event_id)`; server re-validates time bounds and state |
| Bypassing the checkout task rule | Enforced in the check-out service, not the UI |
| Private file exposure | No public media route; authorised streaming only |
| Secrets in git | `.env` gitignored; `.env.example` holds placeholders only; startup check for the secret key |
| Login throttling bypass across workers | `CACHE_URL` shared cache (Redis) in multi-worker deployments |
| HR changing an employee's email, then resetting their password | Accepted HR power (needed to fix wrong emails); limited to accounts ranked below the actor and fully audited (`EMPLOYEE_UPDATED` with old/new email) |
| Data minimisation | No DOB, government ID numbers, gender etc. collected in V1 |
| Sensitive data in logs | Audit `changes` redacts password fields; the audit log is readable only by SUPER_ADMIN; 500 responses return no stack traces |
