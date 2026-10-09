"""Django settings for the Nexvra HRMS backend.

All environment-specific values come from environment variables (see ../.env.example).
"""

from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

# development | staging | production. Staging and production refuse to start with unsafe
# settings (debug on, default/short secret key, wildcard hosts); see docs/deployment.md.
APP_ENV = env("DJANGO_ENV", default="development")
if APP_ENV not in ("development", "staging", "production"):
    raise ImproperlyConfigured("DJANGO_ENV must be development, staging or production.")
IS_DEPLOYED = APP_ENV in ("staging", "production")

DEBUG = env.bool("DJANGO_DEBUG", default=False)
if IS_DEPLOYED and DEBUG:
    raise ImproperlyConfigured(f"DJANGO_DEBUG must be False in {APP_ENV}.")

INSECURE_DEFAULT_KEY = "insecure-dev-key-change-me"
SECRET_KEY = env("DJANGO_SECRET_KEY", default=INSECURE_DEFAULT_KEY)
if not DEBUG and SECRET_KEY == INSECURE_DEFAULT_KEY:
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is False.")
if IS_DEPLOYED and (len(SECRET_KEY) < 50 or SECRET_KEY in ("change-me", INSECURE_DEFAULT_KEY)):
    raise ImproperlyConfigured("Set a strong, unique DJANGO_SECRET_KEY (50+ random characters).")

ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])
if IS_DEPLOYED and (not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS):
    raise ImproperlyConfigured("Set DJANGO_ALLOWED_HOSTS to the real domain name(s); '*' is not allowed.")
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=["http://localhost:3000"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "django_filters",
    "corsheaders",
    "drf_spectacular",
    "apps.core",
    "apps.accounts",
    "apps.organization",
    "apps.employees",
    "apps.attendance",
    "apps.leaves",
    "apps.payroll",
    "apps.documents",
    "apps.notifications",
    "apps.audit",
    "apps.reports",
    "apps.tasks",
    "apps.messaging",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.core.middleware.SlidingSessionMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["ATOMIC_REQUESTS"] = False
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
# India Standard Time (Kanniyakumari / Nagercoil, Tamil Nadu). Storage stays timezone-aware
# (USE_TZ): only display and "which calendar day is it" use this zone.
TIME_ZONE = env("TIME_ZONE", default="Asia/Kolkata")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Private files (employee documents, photos). Never exposed through a public URL;
# served only by authorised API views.
PRIVATE_MEDIA_ROOT = Path(env("PRIVATE_MEDIA_ROOT", default=str(BASE_DIR / "private_media")))
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
        "OPTIONS": {"location": PRIVATE_MEDIA_ROOT, "base_url": None},
    },
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
DEFAULT_MAX_UPLOAD_SIZE_MB = 10
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Used by API throttling (login / password reset). Use a shared cache such as Redis
# (CACHE_URL=redis://...) when running more than one worker process.
CACHES = {"default": env.cache("CACHE_URL", default="locmemcache://")}

# The OpenAPI schema is only served in DEBUG; its documentation hints are not deploy issues.
SILENCED_SYSTEM_CHECKS = ["drf_spectacular.W001", "drf_spectacular.W002"]

# --- Sessions / CSRF / security headers ---------------------------------------
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
# Idle limit: real use restarts it (apps.core.middleware.SlidingSessionMiddleware), so people are
# never signed out in the middle of a working day; an unattended browser signs out after 8 hours.
SESSION_COOKIE_AGE = env.int("SESSION_COOKIE_AGE", default=60 * 60 * 8)
SESSION_RENEW_SECONDS = env.int("SESSION_RENEW_SECONDS", default=5 * 60)
SESSION_COOKIE_NAME = "nexvra_session"
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False  # the SPA must read it to send X-CSRFToken
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
PASSWORD_RESET_TIMEOUT = env.int("PASSWORD_RESET_TIMEOUT", default=60 * 60 * 24)

if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=60 * 60 * 24 * 30)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = env.bool("SECURE_HSTS_PRELOAD", default=False)  # opt-in: hard to undo
    SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

TRUST_X_FORWARDED_FOR = env.bool("TRUST_X_FORWARDED_FOR", default=False)

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = True

FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:3000")

# --- Email ---------------------------------------------------------------------
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
EMAIL_USE_SSL = env.bool("EMAIL_USE_SSL", default=False)  # port 465; use TLS *or* SSL, not both
EMAIL_TIMEOUT = env.int("EMAIL_TIMEOUT", default=15)  # seconds; a slow SMTP server never hangs a request
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="hrms@localhost")
SERVER_EMAIL = env("SERVER_EMAIL", default=DEFAULT_FROM_EMAIL)
if EMAIL_USE_TLS and EMAIL_USE_SSL:
    raise ImproperlyConfigured("Set only one of EMAIL_USE_TLS and EMAIL_USE_SSL.")

# --- Backups (manage.py backup_hrms / restore_hrms) -----------------------------
# Must be outside any publicly served directory. Copy the folder off-site (see docs/backup.md).
BACKUP_DIR = Path(env("BACKUP_DIR", default=str(BASE_DIR.parent / "backups")))
BACKUP_RETENTION_DAYS = env.int("BACKUP_RETENTION_DAYS", default=14)
BACKUP_COPY_DIR = env("BACKUP_COPY_DIR", default="")  # optional second location (mounted/synced drive)
PG_BIN_DIR = env("PG_BIN_DIR", default="")  # folder with pg_dump / pg_restore if not on PATH

# --- Django admin --------------------------------------------------------------
DJANGO_ADMIN_ENABLED = env.bool("DJANGO_ADMIN_ENABLED", default=DEBUG)

# --- REST framework ------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.core.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_RENDERER_CLASSES": ["apps.core.renderers.JSONRenderer"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.exception_handler",
    "DEFAULT_THROTTLE_RATES": {
        "login": env("THROTTLE_LOGIN", default="10/min"),
        "password_reset": env("THROTTLE_PASSWORD_RESET", default="5/hour"),
        "heartbeat": env("THROTTLE_HEARTBEAT", default="30/min"),
    },
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}
if DEBUG:
    REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"].append("rest_framework.renderers.BrowsableAPIRenderer")

SPECTACULAR_SETTINGS = {
    "TITLE": "Nexvra HRMS API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

LOG_FILE = env("LOG_FILE", default="")  # e.g. /var/log/nexvra-hrms/backend.log (rotated, 10 x 5 MB)
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"standard": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "standard"},
        **(
            {
                "file": {
                    "class": "logging.handlers.RotatingFileHandler",
                    "filename": LOG_FILE,
                    "maxBytes": 5 * 1024 * 1024,
                    "backupCount": 10,
                    "formatter": "standard",
                    "encoding": "utf-8",
                }
            }
            if LOG_FILE
            else {}
        ),
    },
    "root": {"handlers": ["console", *(["file"] if LOG_FILE else [])], "level": env("LOG_LEVEL", default="INFO")},
}
