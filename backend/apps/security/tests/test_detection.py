"""Suspicious-login detection: explainable signals, reviewable events, no automatic accusation."""

import datetime

import pytest

from apps.accounts.rbac import EMPLOYEE
from apps.audit.models import AuditLog
from apps.security import services as security_services
from apps.security.models import SecurityEvent

pytestmark = pytest.mark.django_db

UTC = datetime.UTC


def at(hour, minute=0, day=datetime.date(2025, 3, 3)):
    return datetime.datetime.combine(day, datetime.time(hour, minute), tzinfo=UTC)


def make_user(email="sec@example.test"):
    from apps.accounts.models import Role, User
    from apps.employees.models import Employee

    user = User.objects.create_user(email=email, password="Str0ng-test-pass!", first_name="Sec", last_name="User",
                                    role=Role.objects.get(code=EMPLOYEE))
    return Employee.objects.create(user=user, employee_code="EMPSEC", joining_date=datetime.date(2024, 1, 1))


def log_login(employee, ip, ua, moment):
    log = AuditLog.objects.create(
        actor=employee.user, actor_email=employee.user.email, action="LOGIN",
        entity_type="accounts.User", entity_id=str(employee.user.pk),
        ip_address=ip, user_agent=ua,
    )
    AuditLog.objects.filter(pk=log.pk).update(created_at=moment)


def log_failure(ip, ua, moment, email="attacker@example.test"):
    log = AuditLog.objects.create(
        actor=None, actor_email="", action="LOGIN_FAILED",
        metadata={"email": email}, ip_address=ip, user_agent=ua,
    )
    AuditLog.objects.filter(pk=log.pk).update(created_at=moment)


def test_first_login_produces_no_security_event():
    employee = make_user()
    events = security_services.detect_login(None, employee.user, "success", "1.2.3.4", "UA-A", at(9))
    assert events == []
    assert SecurityEvent.objects.count() == 0


def test_new_device_and_new_ip_are_flagged():
    employee = make_user()
    log_login(employee, "1.2.3.4", "UA-A", at(9))
    events = security_services.detect_login(None, employee.user, "success", "5.6.7.8", "UA-B", at(11))
    kinds = {e.kind for e in events}
    assert SecurityEvent.Kind.NEW_DEVICE in kinds
    assert SecurityEvent.Kind.NEW_IP in kinds
    assert all(e.risk_level == SecurityEvent.RiskLevel.MEDIUM for e in events)
    assert all(e.review_status == SecurityEvent.ReviewStatus.OPEN for e in events)


def test_same_device_and_ip_repeated_login_is_not_flagged():
    employee = make_user()
    log_login(employee, "1.2.3.4", "UA-A", at(9))
    events = security_services.detect_login(None, employee.user, "success", "1.2.3.4", "UA-A", at(10))
    assert events == []
    assert SecurityEvent.objects.count() == 0

def test_rapid_ip_change_is_high_risk():
    employee = make_user()
    log_login(employee, "1.2.3.4", "UA-A", at(9))
    events = security_services.detect_login(None, employee.user, "success", "5.6.7.8", "UA-A", at(9, 30))
    kinds = {e.kind for e in events}
    assert SecurityEvent.Kind.RAPID_IP_CHANGE in kinds
    ot = SecurityEvent.objects.get(kind=SecurityEvent.Kind.RAPID_IP_CHANGE)
    assert ot.risk_level == SecurityEvent.RiskLevel.HIGH


def test_repeated_failures_from_one_ip_are_flagged():
    for _ in range(5):
        log_failure("9.9.9.9", "UA-X", at(9))
    events = security_services.detect_login(None, None, "failed", "9.9.9.9", "UA-X", at(9, 15))
    assert any(e.kind == SecurityEvent.Kind.REPEATED_LOGIN_FAILURES for e in events)


def test_below_threshold_failures_not_flagged():
    for _ in range(4):
        log_failure("9.9.9.9", "UA-X", at(9))
    events = security_services.detect_login(None, None, "failed", "9.9.9.9", "UA-X", at(9, 15))
    assert not any(e.kind == SecurityEvent.Kind.REPEATED_LOGIN_FAILURES for e in events)


def test_same_open_event_not_raised_twice():
    employee = make_user()
    log_login(employee, "1.2.3.4", "UA-A", at(9))
    events = security_services.detect_login(None, employee.user, "success", "5.6.7.8", "UA-B", at(11))
    assert len(events) == 2  # NEW_DEVICE + NEW_IP
    again = security_services.detect_login(None, employee.user, "success", "5.6.7.8", "UA-B", at(11, 5))
    assert again == []
    assert SecurityEvent.objects.count() == 2


def test_review_event_changes_status_and_is_audited():
    from apps.audit.models import AuditLog as AL
    employee = make_user()
    event = SecurityEvent.objects.create(
        user=employee.user, employee=employee, kind=SecurityEvent.Kind.NEW_IP,
        risk_level=SecurityEvent.RiskLevel.MEDIUM, ip_address="5.6.7.8",
        review_status=SecurityEvent.ReviewStatus.OPEN,
    )
    before = AL.objects.count()
    updated = security_services.review_event(event, employee.user, SecurityEvent.ReviewStatus.DISMISSED,
                                             "Known home IP.")
    event.refresh_from_db()
    assert updated.review_status == SecurityEvent.ReviewStatus.DISMISSED
    assert updated.reviewed_by_id == employee.user.id
    assert updated.resolution_note == "Known home IP."
    assert AL.objects.count() == before + 1
    assert AL.objects.filter(action="SECURITY_EVENT_REVIEWED").exists()


def test_reviewing_an_already_reviewed_event_conflicts():
    from apps.core.exceptions import Conflict
    employee = make_user()
    event = SecurityEvent.objects.create(
        user=employee.user, kind=SecurityEvent.Kind.NEW_IP, risk_level=SecurityEvent.RiskLevel.MEDIUM,
        ip_address="5.6.7.8", review_status=SecurityEvent.ReviewStatus.REVIEWED,
    )
    with pytest.raises(Conflict):
        security_services.review_event(event, employee.user, SecurityEvent.ReviewStatus.DISMISSED)
