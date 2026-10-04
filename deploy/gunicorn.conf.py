"""Gunicorn settings for the Nexvra HRMS backend (Linux). Started by deploy/systemd/nexvra-backend.service."""

import multiprocessing
import os

bind = os.environ.get("GUNICORN_BIND", "127.0.0.1:8000")  # only nginx talks to it
workers = int(os.environ.get("GUNICORN_WORKERS", min(4, multiprocessing.cpu_count() * 2 + 1)))
threads = 2
timeout = 60
graceful_timeout = 30
keepalive = 5
max_requests = 2000  # recycle workers periodically
max_requests_jitter = 200
accesslog = "-"  # journald
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info").lower()
forwarded_allow_ips = "127.0.0.1"
