"""Company policies (HR-written documents) and the break-allowance policy setting."""

import datetime
from unittest import mock

import pytest

from apps.attendance.models import AttendanceRecord
from apps.audit.models import AuditLog
from apps.organization.models import Policy

pytestmark = pytest.mark.django_db

UTC = datetime.UTC


def make_policy(**fields):
    defaults = {"title": "Communication", "category": Policy.Category.COMMUNICATION, "body": "Use the company chat."}
    return Policy.objects.create(**{**defaults, **fields})


# --- visibility ------------------------------------------------------------------------


@pytest.mark.parametrize("who", ["alice", "manager"])
def test_non_managers_see_only_published_policies(org, client_for, who):
    published = make_policy(title="Conduct", is_published=True)
    draft = make_policy(title="Draft rule", is_published=False)
    client = client_for(org[who])

    res = client.get("/api/policies/")
    assert res.status_code == 200
    assert [p["id"] for p in res.data["results"]] == [published.id]
    assert client.get(f"/api/policies/{published.id}/").status_code == 200
    assert client.get(f"/api/policies/{draft.id}/").status_code == 404
    # asking for drafts explicitly does not reveal them (the filter is ignored)
    assert [p["id"] for p in client.get("/api/policies/?status=draft").data["results"]] == [published.id]


@pytest.mark.parametrize("who", ["hr", "super_admin"])
def test_policy_managers_see_drafts_and_can_filter(org, client_for, who):
    make_policy(title="Conduct", is_published=True)
    make_policy(title="Draft rule", is_published=False)
    client = client_for(org[who])
    assert client.get("/api/policies/").data["count"] == 2
    assert [p["title"] for p in client.get("/api/policies/?status=draft").data["results"]] == ["Draft rule"]
    assert [p["title"] for p in client.get("/api/policies/?status=published").data["results"]] == ["Conduct"]


def test_anonymous_cannot_read_policies(anon):
    assert anon.get("/api/policies/").status_code in (401, 403)


def test_search_and_category_filter(org, client_for):
    make_policy(title="Team chat", category="COMMUNICATION", body="Reply within one working day.", is_published=True)
    make_policy(title="Dress code", category="CONDUCT", body="Business casual.", is_published=True)
    client = client_for(org["alice"])
    assert [p["title"] for p in client.get("/api/policies/?q=working day").data["results"]] == ["Team chat"]
    assert [p["title"] for p in client.get("/api/policies/?q=dress").data["results"]] == ["Dress code"]
    assert [p["title"] for p in client.get("/api/policies/?category=CONDUCT").data["results"]] == ["Dress code"]


# --- management ------------------------------------------------------------------------


@pytest.mark.parametrize("who", ["alice", "manager"])
def test_employees_and_managers_cannot_change_policies(org, client_for, who):
    policy = make_policy(is_published=True)
    client = client_for(org[who])
    payload = {"title": "Mine", "category": "OTHER", "body": "x", "is_published": True}
    assert client.post("/api/policies/", payload, format="json").status_code == 403
    assert client.patch(f"/api/policies/{policy.id}/", {"title": "Changed"}, format="json").status_code == 403
    assert client.delete(f"/api/policies/{policy.id}/").status_code == 403
    policy.refresh_from_db()
    assert policy.title == "Communication"


def test_hr_creates_updates_publishes_and_deletes_with_audit(org, client_for):
    client = client_for(org["hr"])
    res = client.post(
        "/api/policies/",
        {"title": "  Leave notice  ", "category": "LEAVE", "body": "Apply in advance.", "effective_date": "2026-11-01"},
        format="json",
    )
    assert res.status_code == 201, res.data
    assert res.data["title"] == "Leave notice"
    assert res.data["is_published"] is False  # drafts by default
    assert res.data["category_label"] == "Leave"
    pid = res.data["id"]

    res = client.patch(f"/api/policies/{pid}/", {"is_published": True, "body": "Apply two days ahead."}, format="json")
    assert res.status_code == 200, res.data
    assert res.data["updated_by_name"] == org["hr"].user.full_name

    created = AuditLog.objects.get(action="POLICY_CREATED")
    assert "body" not in created.changes  # policy text is not copied into the audit log
    updated = AuditLog.objects.get(action="POLICY_UPDATED")
    assert updated.changes == {"is_published": [False, True]}
    assert updated.metadata == {"body_changed": True}

    assert client.delete(f"/api/policies/{pid}/").status_code == 204
    assert AuditLog.objects.filter(action="POLICY_DELETED").exists()
    assert not Policy.objects.exists()


@pytest.mark.parametrize(
    "payload, field",
    [
        ({"title": "", "category": "OTHER", "body": "x"}, "title"),
        ({"title": "T", "category": "OTHER", "body": "   "}, "body"),
        ({"title": "T", "category": "NOPE", "body": "x"}, "category"),
        ({"title": "T", "category": "OTHER", "body": "x" * 20001}, "body"),
    ],
)
def test_policy_validation(org, client_for, payload, field):
    res = client_for(org["hr"]).post("/api/policies/", payload, format="json")
    assert res.status_code == 400
    assert field in res.data["error"]["fields"]


def test_policy_titles_are_unique_ignoring_case(org, client_for):
    make_policy(title="Working Hours")
    res = client_for(org["hr"]).post(
        "/api/policies/", {"title": "working hours", "category": "OTHER", "body": "x"}, format="json"
    )
    assert res.status_code == 400
    assert "title" in res.data["error"]["fields"]


# --- break allowance (a structured policy rule in Settings) --------------------------------


@pytest.mark.parametrize("value, ok", [(60, True), (None, True), (0, False), (481, False)])
def test_break_allowance_validation(org, client_for, value, ok):
    res = client_for(org["hr"]).patch("/api/settings/", {"break_allowance_minutes": value}, format="json")
    assert (res.status_code == 200) is ok, res.data


def test_only_settings_managers_change_break_allowance(org, client_for):
    res = client_for(org["manager"]).patch("/api/settings/", {"break_allowance_minutes": 60}, format="json")
    assert res.status_code == 403


def test_break_over_allowance_is_reported_on_records(org, client_for, configure):
    day = datetime.date(2025, 3, 3)
    record = AttendanceRecord.objects.create(
        employee=org["alice"],
        date=day,
        check_in=datetime.datetime(2025, 3, 3, 9, tzinfo=UTC),
        check_out=datetime.datetime(2025, 3, 3, 18, tzinfo=UTC),
        total_break_seconds=75 * 60,
    )
    client = client_for(org["hr"])
    url = f"/api/attendance/?date={day.isoformat()}"

    # no allowance configured -> the rule is not applied
    assert client.get(url).data["results"][0]["break_over_allowance_minutes"] is None

    configure(break_allowance_minutes=60)
    row = client.get(url).data["results"][0]
    assert row["id"] == record.id
    assert row["break_over_allowance_minutes"] == 15
    assert row["worked_minutes"] == 9 * 60 - 75  # all break time is excluded from working time

    configure(break_allowance_minutes=90)
    assert client.get(url).data["results"][0]["break_over_allowance_minutes"] == 0


def test_today_payload_includes_break_allowance(org, client_for, configure):
    client = client_for(org["alice"])
    with mock.patch("django.utils.timezone.now", return_value=datetime.datetime(2025, 3, 3, 10, tzinfo=UTC)):
        assert client.get("/api/attendance/today/").data["break_allowance_minutes"] is None
        configure(break_allowance_minutes=60)
        assert client.get("/api/attendance/today/").data["break_allowance_minutes"] == 60
