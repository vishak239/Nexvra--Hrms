import pytest

from apps.notifications.models import Notification
from apps.notifications.services import notify

pytestmark = pytest.mark.django_db


def test_users_see_only_their_notifications(org, client_for):
    notify([org["alice"].user], Notification.Type.GENERAL, "For Alice")
    notify([org["bob"].user], Notification.Type.GENERAL, "For Bob")
    res = client_for(org["alice"]).get("/api/notifications/")
    assert [n["title"] for n in res.data["results"]] == ["For Alice"]
    bob_note = Notification.objects.get(recipient=org["bob"].user)
    assert client_for(org["alice"]).post(f"/api/notifications/{bob_note.id}/mark-read/").status_code == 404


def test_mark_read_and_unread_count(org, client_for):
    notify([org["alice"].user], Notification.Type.GENERAL, "One")
    notify([org["alice"].user], Notification.Type.GENERAL, "Two")
    client = client_for(org["alice"])
    assert client.get("/api/notifications/unread-count/").data["count"] == 2
    first = Notification.objects.filter(recipient=org["alice"].user).first()
    assert client.post(f"/api/notifications/{first.id}/mark-read/").data["is_read"] is True
    assert client.get("/api/notifications/unread-count/").data["count"] == 1
    assert client.post("/api/notifications/mark-all-read/").data["updated"] == 1
    assert client.get("/api/notifications/unread-count/").data["count"] == 0


def test_notify_skips_inactive_and_duplicate_recipients(org):
    org["bob"].user.is_active = False
    org["bob"].user.save()
    rows = notify([org["alice"].user, org["alice"].user, org["bob"].user], Notification.Type.GENERAL, "Hi")
    assert len(rows) == 1
