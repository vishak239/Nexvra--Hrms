# Nexvra HRMS backend (Django REST API) on Railway.
#
# Build context = this backend/ folder (Railway service Root Directory: backend,
# config file path: /backend/railway.json). The Next.js frontend is a separate Railway
# service (Root Directory: frontend) that forwards /api/* here through its BACKEND_URL.
FROM python:3.11-slim

# DJANGO_ENV=production makes settings.py refuse unsafe values (debug on, weak secret key,
# wildcard hosts). Private employee files (documents, photos, message attachments) are
# stored under PRIVATE_MEDIA_ROOT: mount a Railway volume at /data so they survive deploys.
# SECURE_SSL_REDIRECT=False: Railway terminates HTTPS at its edge and its deployment health
# check calls the container over plain HTTP, which Django's own redirect would answer with
# a 301. Secure cookies, HSTS and the HTTPS proxy header stay on (DJANGO_DEBUG=False).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_ENV=production \
    DJANGO_DEBUG=False \
    SECURE_SSL_REDIRECT=False \
    PRIVATE_MEDIA_ROOT=/data/private_media

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# No collectstatic: in production this service only answers JSON (/api/*); the Django admin
# and the browsable API are off when DEBUG is False, and nothing here serves /static/.

EXPOSE 8000

# Railway provides PORT. Its health check uses the host healthcheck.railway.app and the
# generated public domain is in RAILWAY_PUBLIC_DOMAIN; both are appended to the configured
# DJANGO_ALLOWED_HOSTS at start-up, so no hostname is hard-coded here.
CMD ["sh", "-c", "export DJANGO_ALLOWED_HOSTS=\"${DJANGO_ALLOWED_HOSTS:+$DJANGO_ALLOWED_HOSTS,}${RAILWAY_PUBLIC_DOMAIN:+$RAILWAY_PUBLIC_DOMAIN,}healthcheck.railway.app\" && mkdir -p \"$PRIVATE_MEDIA_ROOT\" && exec gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers ${GUNICORN_WORKERS:-2} --threads 2 --timeout 60 --graceful-timeout 30 --max-requests 2000 --max-requests-jitter 200 --forwarded-allow-ips='*' --access-logfile - --error-logfile -"]
