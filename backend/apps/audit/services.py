import datetime
import decimal

from django.db import models

from apps.core.request import client_ip, user_agent

from .models import AuditLog

REDACTED_FIELDS = {"password", "new_password", "current_password", "initial_password", "token"}


def _jsonable(value):
    if isinstance(value, models.Model):
        return value.pk
    if isinstance(value, (datetime.date, datetime.datetime, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if hasattr(value, "name") and hasattr(value, "size"):  # files
        return getattr(value, "name", "")
    return value


def _clean(data):
    return {
        k: ("[redacted]" if k in REDACTED_FIELDS else _jsonable(v)) for k, v in (data or {}).items()
    }


def snapshot(instance, fields):
    return {f: getattr(instance, f) for f in fields}


def diff(before, after):
    """{field: [old, new]} for fields whose value changed."""
    return {k: [before.get(k), after.get(k)] for k in after if before.get(k) != after.get(k)}


def record(request, action, obj=None, changes=None, metadata=None, actor=None):
    if actor is None and request is not None and getattr(request, "user", None) is not None:
        actor = request.user if request.user.is_authenticated else None
    return AuditLog.objects.create(
        actor=actor,
        actor_email=getattr(actor, "email", "") or "",
        action=action,
        entity_type=obj._meta.label if obj is not None else "",
        entity_id=str(obj.pk) if obj is not None else "",
        changes=_clean(changes),
        metadata=_clean(metadata),
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
