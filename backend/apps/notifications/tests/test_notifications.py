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


def test_updates_poll_returns_only_new_items_and_counts(org, client_for):
    import datetime
    from unittest import mock

    from django.utils import timezone

    client = client_for(org["alice"])
    notify([org["alice"].user], Notification.Type.GENERAL, "Old")
    first = client.get("/api/notifications/updates/")
    assert first.status_code == 200
    assert first.data["notifications"] == []  # no cursor yet: nothing is popped up
    assert first.data["unread_notifications"] == 1
    assert first.data["unread_messages"] == 0
    since = first.data["server_time"]
    later = timezone.now() + datetime.timedelta(seconds=5)
    with mock.patch("django.utils.timezone.now", return_value=later):
        notify([org["alice"].user], Notification.Type.GENERAL, "New")
        notify([org["bob"].user], Notification.Type.GENERAL, "Not mine")
        res = client.get("/api/notifications/updates/", {"since": since})
    assert [n["title"] for n in res.data["notifications"]] == ["New"]
    assert res.data["unread_notifications"] == 2
    again = client.get("/api/notifications/updates/", {"since": res.data["server_time"]})
    assert again.data["notifications"] == []  # never shown twice
    assert client.get("/api/notifications/updates/", {"since": "yesterday"}).status_code == 400


def test_updates_poll_resurfaces_a_refreshed_message_alert(org, client_for):
    import datetime
    from unittest import mock

    from django.utils import timezone

    from apps.messaging.models import Conversation
    from apps.notifications.services import notify_collapsed

    conversation = Conversation.objects.create(pair_key=Conversation.key_for(org["alice"].user.pk, org["bob"].user.pk))
    client = client_for(org["alice"])
    notify_collapsed(org["alice"].user, Notification.Type.MESSAGE_RECEIVED, "New message from Bob", "", conversation)
    since = client.get("/api/notifications/updates/").data["server_time"]
    later = timezone.now() + datetime.timedelta(seconds=5)
    with mock.patch("django.utils.timezone.now", return_value=later):
        notify_collapsed(
            org["alice"].user, Notification.Type.MESSAGE_RECEIVED, "New message from Bob", "", conversation
        )
        res = client.get("/api/notifications/updates/", {"since": since})
    assert len(res.data["notifications"]) == 1 and res.data["notifications"][0]["type"] == "MESSAGE_RECEIVED"
    assert Notification.objects.filter(recipient=org["alice"].user).count() == 1  # still one collapsed row


def test_the_same_event_twice_creates_one_notification(org):
    notify([org["alice"].user], Notification.Type.TASK_REMINDER, "Reminder: Update records")
    notify([org["alice"].user, org["bob"].user], Notification.Type.TASK_REMINDER, "Reminder: Update records")
    assert Notification.objects.filter(recipient=org["alice"].user).count() == 1
    assert Notification.objects.filter(recipient=org["bob"].user).count() == 1


def test_password_changes_send_a_security_notice(org, client_for):
    from conftest import PASSWORD

    alice = client_for(org["alice"])
    data = {"current_password": PASSWORD, "new_password": "An0ther-pass-word!"}
    assert alice.post("/api/auth/change-password/", data, format="json").status_code == 200
    note = Notification.objects.get(recipient=org["alice"].user, type="PASSWORD_CHANGED")
    assert "An0ther" not in note.title + note.message  # never the password itself
    admin = client_for(org["super_admin"])
    res = admin.patch(f"/api/users/{org['bob'].user_id}/", {"password": "Res3t-by-admin!"}, format="json")
    assert res.status_code == 200
    notice = Notification.objects.get(recipient=org["bob"].user, type="PASSWORD_CHANGED")
    assert notice.title.endswith("by an administrator")
