# Setup

## Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Python | 3.11+ | Backend |
| PostgreSQL | 16 | Installed locally (Windows: `winget install PostgreSQL.PostgreSQL.16`) |
| Node.js | 20+ (developed on 24) | Frontend and Playwright |
| Git | any recent | |

Docker isn't required.

Commands below use Windows paths (`.venv/Scripts/...`). On macOS/Linux use `.venv/bin/...`.

## 1. Database

Create an application role and database (the role needs `CREATEDB` so the test runner can create its test database):

```sql
-- psql -U postgres -h localhost
CREATE ROLE nexvra LOGIN CREATEDB PASSWORD '<choose-a-password>';
CREATE DATABASE nexvra_hrms OWNER nexvra ENCODING 'UTF8';
```

## 2. Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt     # requirements.txt alone for production
```

Create `backend/.env` from the backend block of the root `.env.example`:

```
DJANGO_DEBUG=True
DJANGO_SECRET_KEY=<python -c "import secrets;print(secrets.token_urlsafe(50))">
DATABASE_URL=postgres://nexvra:<password>@localhost:5432/nexvra_hrms
```

Then:

```bash
.venv/Scripts/python manage.py migrate                # creates tables, roles, permissions, company row
.venv/Scripts/python manage.py createsuperuser        # first Super Admin (email + password)
.venv/Scripts/python manage.py runserver 127.0.0.1:8000
```

Optional fictional demo data (development only; uses `@example.test` accounts):

```bash
.venv/Scripts/python manage.py seed_demo --password "<demo-password>"
```

It creates superadmin@, hr@, manager@, employee@, employee2@ and outsider@example.test, plus demo departments, leave types and salary components, all labelled "Demo".

In development, password-reset emails are printed to the backend console.

## 3. Frontend

```bash
cd frontend
npm install
echo BACKEND_URL=http://127.0.0.1:8000 > .env.local
npm run dev                                           # http://localhost:3000
```

`npm run dev`/`build` first copies `/brand` into `frontend/public/brand` (byte-for-byte). The browser only talks to Next.js; `/api/*` is proxied to Django, so cookies are first-party.

Open http://localhost:3000 and sign in. With demo data: `hr@example.test`, `manager@example.test`, `employee@example.test` or `superadmin@example.test`, using the password you gave `seed_demo`.

For a production-like local run: `npm run build && npm start`.

## 4. First-time configuration (in the app / API)

Nothing company-specific is pre-filled. A Super Admin or HR Admin should:

1. **Settings → Company**: fill in the company profile (Super Admin).
2. **Settings → HR policies**: set the time zone, working days/hours, late grace, half/full-day hours, currency and leave-year start, as decided by Nexvra HR. Leave any unspecified value empty; the dependent rule simply isn't applied.
3. **Settings → Departments / Designations**, and the **Holidays** calendar.
4. **Leave → Leave types**, then **Leave → Balances → Allocate**.
5. **Payroll → Pay components**, then **Payroll → Salary structures**.
6. **Employees → Add employee** (each gets a sign-in account).

## Everyday start / stop (Windows)

- **Start:** double-click `start-hrms.bat` (backend → waits until healthy → frontend → opens the browser).
- **Stop:** double-click `stop-hrms.bat`.
- Starting by hand? Start the **backend first**, then the frontend. If the frontend runs without the backend, the login page shows "Can't reach the Nexvra HRMS server" and the frontend window prints one `[nexvra-hrms] Backend not reachable` line. Start the backend and refresh.
- The app is at http://localhost:3000. http://127.0.0.1:8000 is the API only (its root redirects to the app; `/api/health/` reports status).

## Production notes

- `DJANGO_DEBUG=False` requires `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS` and `DJANGO_CSRF_TRUSTED_ORIGINS`. Secure cookies, HSTS and the SSL redirect are then enabled automatically.
- Serve Django with gunicorn (Linux) behind a TLS reverse proxy, and Next.js with `npm run build && npm start`.
- Set `PRIVATE_MEDIA_ROOT` to a directory that the web server does **not** serve, and back it up along with PostgreSQL.
- Use a shared cache (`CACHE_URL=redis://...`, which needs the `redis` package) when running several worker processes, so login throttling is global.
- Configure SMTP (`EMAIL_*`) for password-reset and new-account emails.
- Run `python manage.py check --deploy` and `python manage.py migrate` on each release.
