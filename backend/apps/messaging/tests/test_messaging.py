import io
import os
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.accounts.models import Permission
from apps.messaging.models import Conversation, Message, MessageAttachment
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db

PDF = b"%PDF-1.4\n% test\n"


def ooxml(kind):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml" if kind == "docx" else "xl/workbook.xml", "<x/>")
    return buf.getvalue()


def start(client, other):
    return client.post("/api/messages/conversations/", {"user_id": other.user_id}, format="json")


def send(client, conversation_id, body="", files=()):
    data = {"body": body}
    if files:
        data["files"] = list(files)
        return client.post(f"/api/messages/conversations/{conversation_id}/messages/", data, format="multipart")
    return client.post(f"/api/messages/conversations/{conversation_id}/messages/", data, format="json")


def test_find_people_by_username_employee_id_and_name(org, client_for):
    alice = client_for(org["alice"])
    bob = org["bob"]
    bob.user.username = "bobby"
    bob.user.save()
    for q in ("@bobby", "bob", bob.employee_code, bob.user.first_name):
        found = {p["user_id"] for p in alice.get("/api/messages/people/", {"q": q}).data["results"]}
        assert bob.user_id in found, q
    results = alice.get("/api/messages/people/", {"q": ""}).data["results"]
    assert org["alice"].user_id not in {p["user_id"] for p in results}  # never yourself
    assert set(results[0]) == {  # a minimal card, no confidential fields
        "user_id", "full_name", "username", "employee_id", "employee_code", "designation", "department",
        "has_photo", "photo_version",
    }


def test_conversation_send_receive_unread_and_read(org, client_for):
    alice, bob = client_for(org["alice"]), client_for(org["bob"])
    res = start(alice, org["bob"])
    assert res.status_code == 201
    conv_id = res.data["id"]
    assert start(bob, org["alice"]).data["id"] == conv_id  # one conversation per pair
    assert start(alice, org["bob"]).status_code == 200

    assert send(alice, conv_id, "Hi Bob").status_code == 201
    assert send(alice, conv_id, "Are you there?").status_code == 201
    assert bob.get("/api/messages/unread-count/").data["count"] == 2
    listing = bob.get("/api/messages/conversations/").data
    assert listing["results"][0]["unread_count"] == 2
    assert listing["results"][0]["last_message"]["body"] == "Are you there?"
    assert listing["results"][0]["other"]["user_id"] == org["alice"].user_id
    # one collapsed notification, not one per message
    assert Notification.objects.filter(recipient=org["bob"].user, type="MESSAGE_RECEIVED", is_read=False).count() == 1

    history = bob.get(f"/api/messages/conversations/{conv_id}/messages/").data
    assert [m["body"] for m in history["results"]] == ["Hi Bob", "Are you there?"]
    assert history["results"][0]["is_mine"] is False and history["has_more"] is False

    assert bob.post(f"/api/messages/conversations/{conv_id}/read/").status_code == 200
    assert bob.get("/api/messages/unread-count/").data["count"] == 0
    assert not Notification.objects.filter(recipient=org["bob"].user, type="MESSAGE_RECEIVED", is_read=False).exists()
    assert alice.get("/api/messages/unread-count/").data["count"] == 0  # own messages never count


def test_history_is_paginated(org, client_for):
    alice = client_for(org["alice"])
    conv_id = start(alice, org["bob"]).data["id"]
    conversation = Conversation.objects.get(pk=conv_id)
    Message.objects.bulk_create(
        [Message(conversation=conversation, sender=org["alice"].user, body=f"m{i}") for i in range(45)]
    )
    page = alice.get(f"/api/messages/conversations/{conv_id}/messages/").data
    assert len(page["results"]) == 30 and page["has_more"] is True
    assert page["results"][-1]["body"] == "m44"
    older = alice.get(f"/api/messages/conversations/{conv_id}/messages/", {"before": page["results"][0]["id"]}).data
    assert len(older["results"]) == 15 and older["has_more"] is False
    newer = alice.get(f"/api/messages/conversations/{conv_id}/messages/", {"after": page["results"][-2]["id"]}).data
    assert [m["body"] for m in newer["results"]] == ["m44"]


def test_non_participants_cannot_read_or_write(org, client_for):
    alice = client_for(org["alice"])
    conv_id = start(alice, org["bob"]).data["id"]
    send(alice, conv_id, "private")
    for who in ("carol", "manager", "hr", "super_admin"):  # no administrative read access either
        other = client_for(org[who])
        assert other.get(f"/api/messages/conversations/{conv_id}/").status_code == 404
        assert other.get(f"/api/messages/conversations/{conv_id}/messages/").status_code == 404
        assert send(other, conv_id, "intrusion").status_code == 404
        assert other.post(f"/api/messages/conversations/{conv_id}/read/").status_code == 404
    assert Message.objects.filter(conversation_id=conv_id).count() == 1


def test_validation(org, client_for):
    alice = client_for(org["alice"])
    assert start(alice, org["alice"]).status_code == 400  # yourself
    assert alice.post("/api/messages/conversations/", {"user_id": 999999}, format="json").status_code == 400
    conv_id = start(alice, org["bob"]).data["id"]
    assert send(alice, conv_id, "   ").status_code == 400
    assert send(alice, conv_id, "x" * 5001).status_code == 400


def test_messaging_permission_is_enforced(org, client_for):
    from apps.accounts.models import Role

    role = Role.objects.get(code="EMPLOYEE")
    role.permissions.remove(Permission.objects.get(codename="messages.use"))
    alice = client_for(org["alice"])
    assert alice.get("/api/messages/conversations/").status_code == 403
    # and people without the permission cannot be messaged
    assert start(client_for(org["manager"]), org["alice"]).status_code == 400


# --- attachments -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "name,content",
    [
        ("report.pdf", PDF),
        ("sheet.xlsx", ooxml("xlsx")),
        ("letter.docx", ooxml("docx")),
        ("data.csv", b"name,days\nalice,2\n"),
        ("legacy.xls", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 32),
        ("photo.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 16),
    ],
)
def test_upload_and_download_attachment(org, client_for, name, content):
    alice, bob = client_for(org["alice"]), client_for(org["bob"])
    conv_id = start(alice, org["bob"]).data["id"]
    res = send(alice, conv_id, "Here you go", [SimpleUploadedFile(name, content)])
    assert res.status_code == 201, res.data
    meta = res.data["attachments"][0]
    assert meta["original_filename"] == name and meta["size"] == len(content)
    attachment = MessageAttachment.objects.get(pk=meta["id"])
    assert attachment.uploaded_by_id == org["alice"].user_id
    assert os.path.basename(attachment.file.name) != name  # stored under a random name
    assert attachment.file.name.startswith("message_files/")
    assert Notification.objects.filter(recipient=org["bob"].user, type="FILE_RECEIVED").exists()

    download = bob.get(meta["download_url"])
    assert download.status_code == 200
    assert b"".join(download.streaming_content) == content
    assert download["Cache-Control"] == "private, no-store"
    assert download["X-Content-Type-Options"] == "nosniff"


@pytest.mark.parametrize(
    "name,content",
    [
        ("evil.exe", b"MZ\x90\x00"),
        ("fake.pdf", b"<html><script>alert(1)</script>"),
        ("renamed.xlsx", b"PK\x03\x04" + b"\x00" * 30),  # zip signature but not a spreadsheet
        ("binary.csv", b"a,b\x00\x01\x02"),
        ("empty.pdf", b""),
        ("page.html", b"<html></html>"),
    ],
)
def test_invalid_attachments_rejected(org, client_for, name, content):
    alice = client_for(org["alice"])
    conv_id = start(alice, org["bob"]).data["id"]
    res = send(alice, conv_id, "file", [SimpleUploadedFile(name, content)])
    assert res.status_code == 400
    assert "files" in res.data["error"]["fields"]
    assert not MessageAttachment.objects.exists() and not Message.objects.exists()


def test_attachment_count_limit(org, client_for):
    alice = client_for(org["alice"])
    conv_id = start(alice, org["bob"]).data["id"]
    files = [SimpleUploadedFile(f"f{i}.pdf", PDF) for i in range(6)]
    assert send(alice, conv_id, "", files).status_code == 400


def test_unauthorized_download_by_guessing_id_is_404(org, client_for):
    alice = client_for(org["alice"])
    conv_id = start(alice, org["bob"]).data["id"]
    attachment_id = send(alice, conv_id, "", [SimpleUploadedFile("r.pdf", PDF)]).data["attachments"][0]["id"]
    for who in ("carol", "hr", "super_admin"):
        res = client_for(org[who]).get(f"/api/messages/attachments/{attachment_id}/download/")
        assert res.status_code == 404
    assert client_for(org["alice"]).get(f"/api/messages/attachments/{attachment_id}/download/").status_code == 200


def test_anonymous_rejected(anon):
    assert anon.get("/api/messages/conversations/").status_code == 401
    assert anon.get("/api/messages/attachments/1/download/").status_code == 401
