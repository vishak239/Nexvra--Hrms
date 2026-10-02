# HRMS V1 Scope

V1 is a **normal HRMS**. It has no AI and no monitoring. Policies are configurable, not invented (see `requirements-analysis.md`).

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

**Reports & dashboards**
- Headcount, attendance summary, leave summary, payroll summary (JSON + CSV)
- Role-aware dashboard API using real data only

**Frontend** (implemented)
- Next.js screens for all of the above. No Stitch screens were supplied, so the design is built on the Nexvra brand and can be re-skinned centrally.

**Quality**
- Pytest suite covering auth, RBAC, isolation, every module
- Playwright critical flows (once the UI exists)
- Docs: README, setup, architecture, database, API, testing

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
- Shift scheduling, overtime, geo-fenced or device-based attendance
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
- Activity monitoring, productivity scoring, screenshots, keystrokes
- Face recognition / computer vision attendance
- Predictive analytics, AI-driven HR decisions

These would need a separate legal and privacy review before any design work.
