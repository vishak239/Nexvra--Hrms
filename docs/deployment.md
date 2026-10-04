# Production deployment

This guide puts Nexvra HRMS on a Linux server with your own domain and HTTPS. It uses the files in [`deploy/`](../deploy). Everything shown as `<...>` is a value only you can provide. This repository never contains real domains, IP addresses or credentials.

## Values you must provide

| Value | Where it goes |
|---|---|
| Domain name (e.g. `hrms.your-company.com`) | DNS **A/AAAA record → server IP**; `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS`, `FRONTEND_URL` in `/etc/nexvra-hrms/backend.env`; `server_name` in the nginx site |
| Server IP address | Your DNS provider (A record), and your SSH access |
| Database password | `DATABASE_URL` in `/etc/nexvra-hrms/backend.env` (and the `CREATE ROLE` command below) |
| Django secret key | `DJANGO_SECRET_KEY` in `/etc/nexvra-hrms/backend.env`; generate with `python3 -c "import secrets; print(secrets.token_urlsafe(64))"` |
| SMTP host, port, user and password | `EMAIL_*` in `/etc/nexvra-hrms/backend.env` (see [SMTP](#smtp-email)) |
| Off-site backup location (optional) | `BACKUP_COPY_DIR`, or your sync tool (see [backup.md](backup.md)) |
| Workplace coordinates for the 20 m check-in rule | In the app: **Settings → HR policies → Workplace & monitoring** |

## Architecture

```
Internet ──HTTPS──► nginx :443 ──/api/──► gunicorn (Django) 127.0.0.1:8000 ──► PostgreSQL 16 (local)
                         └──── /  ─────► Next.js           127.0.0.1:3000
systemd: nexvra-backend, nexvra-frontend, nexvra-reconcile.timer (every 2 min), nexvra-backup.timer (daily 02:30)
```

Private files (`PRIVATE_MEDIA_ROOT`) and backups (`BACKUP_DIR`) live outside every web-served folder. Files are only delivered through authorised API endpoints.

## 1. Server preparation (Ubuntu 24.04 LTS)

```bash
sudo apt update && sudo apt install -y postgresql-16 nginx python3.12-venv python3-pip git certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs
sudo useradd --system --create-home --home-dir /opt/nexvra-hrms --shell /usr/sbin/nologin nexvra
sudo mkdir -p /etc/nexvra-hrms /var/lib/nexvra-hrms/private_media /var/log/nexvra-hrms /var/backups/nexvra-hrms
sudo chown -R nexvra:nexvra /var/lib/nexvra-hrms /var/log/nexvra-hrms /var/backups/nexvra-hrms
sudo chmod 700 /var/lib/nexvra-hrms /var/backups/nexvra-hrms
```

Firewall: allow only 22, 80 and 443 (`sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable`). PostgreSQL stays on localhost.

## 2. Database

```bash
sudo -u postgres psql -c "CREATE ROLE nexvra LOGIN PASSWORD '<db-password>';"
sudo -u postgres psql -c "CREATE DATABASE nexvra_hrms OWNER nexvra;"
```

## 3. Code and configuration

```bash
sudo -u nexvra git clone <your-repository-url> /opt/nexvra-hrms     # or copy the release files
sudo cp /opt/nexvra-hrms/deploy/env/backend.env.production.example  /etc/nexvra-hrms/backend.env
sudo cp /opt/nexvra-hrms/deploy/env/frontend.env.production.example /etc/nexvra-hrms/frontend.env
sudo nano /etc/nexvra-hrms/backend.env          # fill in every <...> value
sudo chown root:nexvra /etc/nexvra-hrms/*.env && sudo chmod 640 /etc/nexvra-hrms/*.env
```

`DJANGO_ENV=production` makes the backend **refuse to start** if:

- debug is on;
- the secret key is missing, short, or a default;
- `DJANGO_ALLOWED_HOSTS` is empty or `*`.

`staging` applies the same checks; use it for a test server with its own database and domain.

## 4. Build

```bash
cd /opt/nexvra-hrms/backend
sudo -u nexvra python3 -m venv .venv
sudo -u nexvra .venv/bin/pip install -r requirements.txt
sudo -u nexvra bash -c 'set -a; . /etc/nexvra-hrms/backend.env; set +a; .venv/bin/python manage.py migrate && .venv/bin/python manage.py collectstatic --noinput && .venv/bin/python manage.py check --deploy'
cd /opt/nexvra-hrms/frontend
sudo -u nexvra npm ci && sudo -u nexvra npm run build
```

`check --deploy` must show no issues. One warning is expected and safe: `security.W021`, because HSTS preload is opt-in.

The first Super Admin is created with `manage.py createsuperuser`. Do **not** run `seed_demo` in production; it refuses to run there anyway.

## 5. HTTPS and nginx

```bash
sed "s/hrms.example.com/<your-domain>/g" /opt/nexvra-hrms/deploy/nginx/nexvra-hrms.conf.template | sudo tee /etc/nginx/sites-available/nexvra-hrms
sudo ln -s /etc/nginx/sites-available/nexvra-hrms /etc/nginx/sites-enabled/ && sudo rm -f /etc/nginx/sites-enabled/default
sudo mkdir -p /var/www/certbot
sudo certbot certonly --webroot -w /var/www/certbot -d <your-domain>     # free Let's Encrypt certificate (auto-renews)
sudo nginx -t && sudo systemctl reload nginx
```

The site redirects HTTP to HTTPS and sends HSTS and security headers. Django also enforces the following, with the proxy header handled by `SECURE_PROXY_SSL_HEADER`:

- secure, HttpOnly session cookie;
- secure CSRF cookie;
- `SECURE_SSL_REDIRECT`;
- the trusted origin.

## 6. Services and scheduled jobs

```bash
sudo cp /opt/nexvra-hrms/deploy/systemd/*.service /opt/nexvra-hrms/deploy/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nexvra-backend nexvra-frontend nexvra-reconcile.timer nexvra-backup.timer
systemctl list-timers 'nexvra-*'
```

- `nexvra-reconcile.timer` applies the attendance time rules every 2 minutes, even when nobody's browser is open: inactivity check-out, the break allowance and overtime auto-stop.
- `nexvra-backup.timer` runs the verified backup every night (see [backup.md](backup.md)).

## SMTP email

Fill in `EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend` and the `EMAIL_*` values. Use **either** `EMAIL_USE_TLS=True` (port 587) **or** `EMAIL_USE_SSL=True` (port 465). Then test:

```bash
sudo -u nexvra bash -c 'set -a; . /etc/nexvra-hrms/backend.env; set +a; cd /opt/nexvra-hrms/backend; .venv/bin/python manage.py send_test_email --to <you@your-domain.com>'
```

The command prints the configuration without the password and the server's exact reason if delivery fails.

Emails sent:

- password-reset links;
- set-password links for new accounts (never a password);
- WFH and overtime decisions.

A delivery failure is logged on `nexvra.email` and never blocks the HR action. Most providers require SPF/DKIM records for your domain so mail is not marked as spam.

## Logs

| What | Where |
|---|---|
| Backend requests and errors | `journalctl -u nexvra-backend` and `LOG_FILE` (`/var/log/nexvra-hrms/backend.log`, rotated 10 × 5 MB) |
| Frontend | `journalctl -u nexvra-frontend` |
| Scheduled jobs | `journalctl -u nexvra-reconcile -u nexvra-backup`; backups also write `BACKUP_DIR/backup.log` |
| nginx | `/var/log/nginx/` |

Users never see stack traces or database errors: `DEBUG=False`, and every API error uses the generic JSON format.

## Updating to a new version

```bash
cd /opt/nexvra-hrms && sudo -u nexvra git pull
sudo -u nexvra bash -c 'set -a; . /etc/nexvra-hrms/backend.env; set +a; cd backend; .venv/bin/pip install -r requirements.txt; .venv/bin/python manage.py migrate; .venv/bin/python manage.py collectstatic --noinput'
cd frontend && sudo -u nexvra npm ci && sudo -u nexvra npm run build
sudo systemctl restart nexvra-backend nexvra-frontend
```

Take a backup first (`sudo systemctl start nexvra-backup`).

## Production checklist

- [ ] DNS points to the server; `https://<your-domain>` shows a valid certificate
- [ ] `backend.env` filled in; `DJANGO_ENV=production`; secret key unique; file mode 640
- [ ] `manage.py check --deploy` has no issues other than `security.W021`
- [ ] `send_test_email` succeeds; password reset works end to end
- [ ] Workplace coordinates set in Settings (otherwise the 20 m rule is not applied)
- [ ] `systemctl list-timers` shows the reconcile and backup timers
- [ ] First backup created **and** a test restore done ([backup.md](backup.md))
- [ ] Backups are copied off the server
- [ ] Demo accounts are not present; the first Super Admin has a strong password
- [ ] Firewall allows only 22, 80 and 443
