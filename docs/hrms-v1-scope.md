# HRMS V1 Scope

V1 is a **normal HRMS**. It has no AI and no surveillance. Policies are configurable, not invented (see `requirements-analysis.md`).

The second release (2026-10-02) added work sessions, tasks and messaging. They are listed under **ADDED IN RELEASE 2** below.

## MUST HAVE — V1

**Platform**
- Email + password login and logout; HttpOnly session cookie + CSRF; login rate limiting
- Password change and the password-reset flow (signed token; console email in dev, SMTP via env)
- Account active/inactive status
- Backend-enforced RBAC: 4 system roles, a permission catalogue, role→permission mapping, object-level scoping (own / team / all)
- Privilege-escalation guard on role assignment
- Immutable audit log for security-relevant and HR actions
- Consistent JSON error format, pagination, filtering
- `.env`-driven configuration; no secrets in source

**Organisation**
- Company profile (singleton)
- Policy settings (all nullable / configurable)
- Departments, designations (CRUD; deactivate instead of delete when in use)
- Holiday calendar

**People**
- Employee CRUD by HR, with an optional login account created at the same time
- Role-aware profile: self, manager (basic team fields), HR (full)
- Direct-manager relationship (defines "team")
- Profile photo (private, validated)

**Attendance**
- Self check-in / check-out (if enabled in settings)
- Daily record with late / half-day computed **only** from configured thresholds
- My history, team history (manager), all records + manual correction (HR, audited)

**Leave**
- Leave types (HR-defined), yearly balances (HR-allocated; used/pending computed)
- Apply, cancel, approve, reject; overlap and balance validation; holiday/working-day aware day count
- Manager approves direct reports; HR approves anyone; nobody approves their own request

**Payroll** (basic, non-statutory)
- Pay components (earning/deduction), per-employee salary structures with effective dates
- Monthly payroll run: generate draft payslips → manual adjustments → finalize (locks)
- Employees see only their own finalized payslips

**Documents**
- HR uploads documents per employee with a category and an employee-visibility flag
- Authorised streaming download only; type/size/magic-byte validation

**Notifications** (in-app)
- Leave submitted, leave decided, payslip published, document shared; read/unread
- Release 2: task assigned / reminder / response / completed / cancelled, message and file received, overtime started / completed, offline sync problems

**Reports & dashboards**
- Headcount, attendance summary, leave summary, payroll summary (JSON + CSV)
- Role-aware dashboard API using real data only

**Frontend** (implemented)
- Next.js screens for all of the above. No Stitch screens were supplied, so the design is built on the Nexvra brand and can be re-skinned centrally.

**Quality**
- Pytest suite covering auth, RBAC, isolation, every module
- Playwright critical flows (once the UI exists)
- Docs: README, setup, architecture, database, API, testing

## ADDED IN RELEASE 2 (implemented 2026-10-02)
- Break tracking with a live timer; breaks excluded from working time
- Separate overtime sessions after check-out (recording only; no approval or pay)
- HR task management: assign by Employee ID or @username, respond, complete, cancel, remind
- Task checkout protection (Super Admin exempt), enforced by the API
- Private 1:1 messaging with secure file sharing
- Leave approval lock and an exactly-once balance ledger
- Work-session recovery after the browser is closed, offline mode with an idempotent sync queue, connection status indicator
- HR / manager monitoring of attendance, breaks, overtime, tasks, leave decisions, balance changes and offline sync (Reports → Activity monitoring)

Details: [work-sessions-tasks-messaging.md](work-sessions-tasks-messaging.md).

## SHOULD HAVE — V1 if time permits
- Custom roles beyond the four system roles (the model already supports them; UI pending)
- Attendance regularisation requests (employee asks, manager/HR approves)
- Email delivery of notifications (SMTP)
- Printable/PDF payslip
- Employee ID auto-numbering (configurable prefix)
- Bulk employee import (CSV)
- OpenAPI schema browser for the API (`/api/schema/`)

## LATER — V2/V3
- Multi-level / configurable leave approval chains
- Leave accrual, carry-forward, encashment
- Statutory payroll (PF/ESI/TDS/PT), proration, loss-of-pay, arrears, bank file exports, Form 16
- Shift scheduling, overtime approval and pay, geo-fenced or device-based attendance
- Real-time messaging (WebSocket), group conversations
- Employee self-service document upload + HR verification workflow (the setting exists, off by default)
- Company directory / org chart
- Onboarding/offboarding checklists, asset management
- Performance reviews, goals, recruitment/ATS
- SSO (Google Workspace / Microsoft), 2FA
- Multi-company / multi-entity tenancy
- Data retention automation, GDPR/DPDP export & erasure tooling
- Mobile app

## AI / ACTIVITY MONITORING — FUTURE (explicitly excluded from V1)
- AI chatbot / LLM features
- Activity surveillance: productivity scoring, screenshots, keystrokes, app/URL tracking (the release 2 "Activity monitoring" report only lists HR records the employee creates themselves: attendance, breaks, overtime, tasks, leave)
- Face recognition / computer vision attendance
- Predictive analytics, AI-driven HR decisions

These would need a separate legal and privacy review before any design work.
