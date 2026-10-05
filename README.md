# Nexvra HRMS

Internal Human Resource Management System for **Nexvra Solutions**. A standard HRMS (no AI, no screen or activity surveillance) with work-session tracking, HR tasks and private messaging.

| Area | Status |
|---|---|
| Backend API (Django + DRF + PostgreSQL) | Implemented and tested: auth, RBAC, company/settings, departments, designations, holidays, employees, attendance, leave, payroll, documents, notifications, audit log, reports, dashboard |
| Work sessions | Office check-in only within **20 m** of the workplace (server-verified geofence; automatic check-out on leaving); **work from home** with HR approval; **60-minute daily break allowance**; **30-minute inactivity** auto check-out (privacy-safe: timestamps only; activity seen offline still counts, device-wide activity on Chrome/Edge with permission); **Resume Work** after an inactivity check-out (reason → HR/Admin approval → normal check-in again, gap recorded as non-working time); **meetings** (overall or selected employees) pause working time without a new check-in; overtime with a task/reason declaration, **HR approval** and inactivity auto-stop; offline mode with an idempotent sync queue; session recovery. Actions are in the top-right header. |
| Tasks | HR assigns tasks by Employee ID **or** @username; employees respond and complete; unanswered tasks block checkout (Super Admin exempt) |
| Messaging | Private 1:1 conversations with secure file sharing (PDF, Office, CSV, images); links in messages are clickable (safely) |
| Alerts | Desktop (operating-system) popups with sound for new notifications and messages when the tab is in the background, with the user's browser permission; in-app toasts otherwise |
| Leave | Approved leave is locked; the balance is deducted exactly once, on approval, with an audited ledger |
| Look and feel | Stitch design system in **light and dark** themes (remembered per browser, follows the device by default) |
| Operations | Environment-separated settings (development / staging / production guards), SMTP with diagnostics, verified database + file backups with restore, nginx/HTTPS + systemd deployment files |
| Policies | HR writes company policies (drafts, publish, search, categories); everyone reads the published ones next to the rules the system enforces (working hours, grace time, daily break allowance, …) |
| Frontend (Next.js + TypeScript + Tailwind) | Implemented: 27 role-aware screens covering sign-in, dashboard, employees, attendance, meetings, leave, holidays, policies, tasks, messages, payroll, payslips, documents, reports (with activity monitoring), notifications, settings, users & roles, and the audit log. Responsive with a mobile menu. |
| UI design | The official Stitch design (`stitch_nexvra_hrms_enterprise_platform/`, "Obsidian Kinetic": dark surfaces, electric-lime accent, Space Grotesk + Inter, Material Symbols). Its tokens are copied verbatim into `frontend/tailwind.config.ts`, and every screen uses the shared components in `frontend/src/components/ui/`. |
| Official logo | `brand/nexvra-logo.svg`, as confirmed by the owner, used unmodified |
| HR policies | None supplied. Every policy is **configurable** and starts empty (see `docs/requirements-analysis.md`) |

## Architecture

```
Browser ──► Next.js :3000 ──/api/* proxy──► Django REST API :8000 ──► PostgreSQL 16
                                                │
                                                └── private file storage (documents, photos, message files; never public)
```

- **Session authentication** (HttpOnly cookie + CSRF). The browser only talks to Next.js, so cookies are first-party.
- **Backend-enforced RBAC.** Roles SUPER_ADMIN, HR_ADMIN, MANAGER and EMPLOYEE map to permission codes. Querysets are scoped to own / team / all; out-of-scope objects return 404.
- **Business logic in `services.py`.** Views stay thin. Important actions are written to an append-only audit log.

Details: [docs/architecture.md](docs/architecture.md).

```
backend/     Django project (config/ + apps/<module>/{models,serializers,services,views,tests})
frontend/    Next.js app: src/app/(auth) sign-in pages, src/app/(app) screens, src/components/ui shared components
brand/       Official brand assets (single source of truth)
stitch_nexvra_hrms_enterprise_platform/   Official Stitch UI export (design source of truth: screens, code.html, DESIGN.md)
design/      Older design references
docs/        Project documentation
tests/e2e/   Playwright end-to-end tests
```

## Run the app (Windows)

Double-click **`start-hrms.bat`** in the project folder. It:

1. starts the backend API (port 8000) in its own window, then waits until it's healthy,
2. starts the frontend (port 3000) in its own window (builds it first if needed),
3. opens **http://localhost:3000** in your browser.

To stop everything, double-click **`stop-hrms.bat`** (or close the two server windows).

> Always use **http://localhost:3000**. Port 8000 is only the API; opening it in a browser redirects you to the app.

### Troubleshooting

| You see | Meaning | Fix |
|---|---|---|
| "Can't reach the Nexvra HRMS server" on the login page, or `[nexvra-hrms] Backend not reachable` in the frontend window | The frontend is running but the backend isn't | Start the backend first, or just use `start-hrms.bat`, which starts things in the right order |
| The backend window closes or shows a database error | PostgreSQL isn't running | Start the Windows service `postgresql-x64-16` (Services app), then run `start-hrms.bat` again |
| Code changes don't show up in the browser | `npm start` serves the last build | `cd frontend && npm run build`, then restart |
| "Too many requests" when signing in | Login rate limit (10 per minute) | Wait a minute |
| "Offline mode" in the header | The browser has no network, or the server can't be reached | Breaks/overtime keep working and sync automatically; check-in/out wait for the connection |
| Errors after updating the code | Database not migrated | `cd backend && .venv\Scripts\python manage.py migrate` (also run by `start-hrms.bat`) |

## Prerequisites

Python 3.11+, PostgreSQL 16, Node.js 20+, Git. Full instructions: [docs/setup.md](docs/setup.md).

## Quick start (development)

```bash
# Database (once)
psql -U postgres -c "CREATE ROLE nexvra LOGIN CREATEDB PASSWORD '<pw>';" -c "CREATE DATABASE nexvra_hrms OWNER nexvra;"

# Backend
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt        # macOS/Linux: .venv/bin/...
cp ../.env.example .env                                   # keep the backend block and fill in the values
.venv/Scripts/python manage.py migrate
.venv/Scripts/python manage.py createsuperuser
.venv/Scripts/python manage.py seed_demo --password "<demo-pw>"   # optional, fictional data
.venv/Scripts/python manage.py runserver 127.0.0.1:8000

# Frontend (second terminal)
cd frontend
npm install
echo BACKEND_URL=http://127.0.0.1:8000 > .env.local
npm run dev                                               # http://localhost:3000
```

API docs (development): http://127.0.0.1:8000/api/docs/. Reference: [docs/api.md](docs/api.md).

## Environment variables

All configuration comes from environment variables. [`.env.example`](.env.example) lists every variable, with placeholders only. Key ones:

| Variable | Purpose |
|---|---|
| `DJANGO_SECRET_KEY` | Required when `DJANGO_DEBUG=False` (startup fails without it) |
| `DJANGO_DEBUG` | `True` only for development |
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` |
| `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS` | Production host / origin lists |
| `PRIVATE_MEDIA_ROOT` | Private document storage (must not be web-served) |
| `FRONTEND_URL` | Used in password-reset links |
| `EMAIL_*` | SMTP for reset/new-account emails (console in development) |
| `CACHE_URL` | Shared cache for throttling with multiple workers |
| `BACKEND_URL` (frontend) | Where Next.js proxies `/api/*` |

`.env` files are git-ignored. Never commit secrets.

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest       # 324 tests on PostgreSQL
cd frontend && npm test && npm run typecheck        # 126 unit + component tests
cd tests/e2e && E2E_PASSWORD="<demo-pw>" npx playwright test   # 65 tests (API + browser UI); see docs/testing.md
```

See [docs/testing.md](docs/testing.md).

## Development workflow

1. Create a branch per change.
2. Change models → `makemigrations` → commit the migration with the code.
3. Put business rules in `services.py`, with permissions declared on the view (`required_permissions`) and scoping via `scope_queryset`.
4. Add or extend tests (especially access-control tests) → run `pytest`, `ruff check .`, and the frontend checks.
5. New permission? Add it to `backend/apps/accounts/rbac.py` and run `manage.py sync_rbac`.
6. Company policy decisions belong in **Settings** (`CompanySettings`), never hard-coded.

## Documentation

| Document | Contents |
|---|---|
| [project-inventory.md](docs/project-inventory.md) | What existed at project start; file decisions |
| [requirements-analysis.md](docs/requirements-analysis.md) | Requirements by module; NOT SPECIFIED — CONFIGURABLE items; open questions for HR |
| [hrms-v1-scope.md](docs/hrms-v1-scope.md) | Must / should / later / excluded |
| [architecture.md](docs/architecture.md) | Frontend, backend, auth, RBAC, files, audit, security |
| [work-sessions-tasks-messaging.md](docs/work-sessions-tasks-messaging.md) | Breaks (+ daily allowance), overtime, tasks + checkout rule, leave lock & balance ledger, messaging & files, offline mode, monitoring, company policies |
| [meetings-resume-activity.md](docs/meetings-resume-activity.md) | Meetings, Resume Work, the four time categories, activity detection (and its browser limits), desktop alerts, message links |
| [database.md](docs/database.md) | Tables, constraints, migrations |
| [api.md](docs/api.md) | Every endpoint with its permission |
| [setup.md](docs/setup.md) | Installation and first-time configuration |
| [deployment.md](docs/deployment.md) | Production server, domain, HTTPS, environment, services, SMTP, logs, checklist |
| [backup.md](docs/backup.md) | Automatic verified backups, retention, off-site copies, restore |
| [testing.md](docs/testing.md) | Test suites and how to run them |
