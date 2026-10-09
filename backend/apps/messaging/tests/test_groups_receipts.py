"""Group conversations, membership rules and read receipts (delivered / seen)."""

import pytest

from apps.messaging.models import Conversation, ConversationParticipant
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db


def start_direct(client, other_user):
    res = client.post("/api/messages/conversations/", {"user_id": other_user.pk}, format="json")
    assert res.status_code in (200, 201), res.data
    return res.data["id"]


def send(client, conversation_id, body="Hello"):
    res = client.post(f"/api/messages/conversations/{conversation_id}/messages/", {"body": body}, format="json")
    assert res.status_code == 201, res.data
    return res.data


def make_group(client, name, *users):
    return client.post("/api/messages/groups/", {"name": name, "user_ids": [u.pk for u in users]}, format="json")


# --- direct read receipts -------------------------------------------------------------------


def test_direct_message_goes_sent_then_delivered_then_seen(org, client_for):
    alice, bob = client_for(org["alice"]), client_for(org["bob"])
    cid = start_direct(alice, org["bob"].user)
    msg = send(alice, cid)
    assert msg["receipt"]["status"] == "sent"  # Bob's app has not picked it up yet
    assert msg["sender"]["full_name"] == org["alice"].user.full_name

    bob.get("/api/notifications/updates/")  # Bob's app polls in the background: delivered
    receipts = alice.get(f"/api/messages/conversations/{cid}/receipts/").data["receipts"]
    assert receipts[str(msg["id"])]["status"] == "delivered"

    assert bob.post(f"/api/messages/conversations/{cid}/read/").status_code == 200  # Bob opens it
    receipts = alice.get(f"/api/messages/conversations/{cid}/receipts/").data["receipts"]
    assert receipts[str(msg["id"])] == {"status": "seen", "recipient_count": 1, "delivered_count": 1,
                                         "read_count": 1, "seen_by": []}
    # Receipts only describe the caller's own messages, and never carry message text.
    bob_view = bob.get(f"/api/messages/conversations/{cid}/messages/").data["results"]
    assert bob_view[0]["receipt"] is None
    assert "body" not in receipts[str(msg["id"])]


def test_unseen_messages_never_show_seen(org, client_for):
    alice, bob = client_for(org["alice"]), client_for(org["bob"])
    cid = start_direct(alice, org["bob"].user)
    first = send(alice, cid, "One")
    bob.post(f"/api/messages/conversations/{cid}/read/")
    second = send(alice, cid, "Two")
    receipts = alice.get(f"/api/messages/conversations/{cid}/receipts/").data["receipts"]
    assert receipts[str(first["id"])]["status"] == "seen"
    assert receipts[str(second["id"])]["status"] == "sent"


def test_receipts_are_private_to_members(org, client_for):
    alice = client_for(org["alice"])
    cid = start_direct(alice, org["bob"].user)
    send(alice, cid)
    carol = client_for(org["carol"])
    assert carol.get(f"/api/messages/conversations/{cid}/receipts/").status_code == 404
    hr = client_for(org["hr"])  # no administrative access either
    assert hr.get(f"/api/messages/conversations/{cid}/receipts/").status_code == 404


def test_delivery_marking_is_a_single_write_only_when_needed(org, client_for, django_assert_num_queries):
    from apps.messaging.services import mark_delivered

    alice = client_for(org["alice"])
    cid = start_direct(alice, org["bob"].user)
    send(alice, cid)
    with django_assert_num_queries(1):
        assert mark_delivered(org["bob"].user) == 1
    with django_assert_num_queries(1):
        assert mark_delivered(org["bob"].user) == 0  # nothing new: nothing written


# --- groups -----------------------------------------------------------------------------------


def test_create_group_send_and_every_member_reads_the_history(org, client_for):
    alice = client_for(org["alice"])
    res = make_group(alice, "  Project   Atlas ", org["bob"].user, org["carol"].user, org["bob"].user)
    assert res.status_code == 201, res.data
    group = res.data
    assert group["kind"] == "GROUP" and group["name"] == "Project Atlas" and group["member_count"] == 3
    assert group["my_role"] == "OWNER"
    assert {m["user_id"] for m in group["members"]} == {org["alice"].user_id, org["bob"].user_id, org["carol"].user_id}
    for who in ("bob", "carol"):
        assert Notification.objects.filter(recipient=org[who].user, type="GROUP_ADDED").exists()

    msg = send(alice, group["id"], "Kick-off at 10")
    assert msg["receipt"]["recipient_count"] == 2 and msg["receipt"]["status"] == "sent"
    for who in ("bob", "carol"):
        client = client_for(org[who])
        listed = client.get("/api/messages/conversations/").data["results"]
        assert any(c["id"] == group["id"] and c["unread_count"] == 1 for c in listed)
        history = client.get(f"/api/messages/conversations/{group['id']}/messages/").data["results"]
        assert [m["body"] for m in history] == ["Kick-off at 10"]
        assert Notification.objects.filter(recipient=org[who].user, type="GROUP_MESSAGE_RECEIVED").exists()

    client_for(org["bob"]).post(f"/api/messages/conversations/{group['id']}/read/")
    r = alice.get(f"/api/messages/conversations/{group['id']}/receipts/").data["receipts"][str(msg["id"])]
    assert r["read_count"] == 1 and r["seen_by"] == [org["bob"].user_id] and r["status"] == "delivered"
    client_for(org["carol"]).post(f"/api/messages/conversations/{group['id']}/read/")
    r = alice.get(f"/api/messages/conversations/{group['id']}/receipts/").data["receipts"][str(msg["id"])]
    assert r["status"] == "seen" and sorted(r["seen_by"]) == sorted([org["bob"].user_id, org["carol"].user_id])


def test_group_validation(org, client_for):
    alice = client_for(org["alice"])
    assert make_group(alice, "x", org["bob"].user, org["carol"].user).status_code == 400  # name too short
    assert make_group(alice, "Pair", org["bob"].user).status_code == 400  # needs at least two others
    assert make_group(alice, "Only me", org["alice"].user, org["alice"].user).status_code == 400
    ghosts = {"name": "Ghosts", "user_ids": [999999, org["bob"].user_id]}
    res = alice.post("/api/messages/groups/", ghosts, format="json")
    assert res.status_code == 400
    org["carol"].user.is_active = False
    org["carol"].user.save()
    assert make_group(alice, "Inactive", org["bob"].user, org["carol"].user).status_code == 400


def test_non_members_cannot_see_or_join_a_group(org, client_for):
    alice = client_for(org["alice"])
    gid = make_group(alice, "Core team", org["bob"].user, org["manager"].user).data["id"]
    send(alice, gid, "Confidential plan")
    for who in ("carol", "hr", "super_admin"):
        client = client_for(org[who])
        assert client.get(f"/api/messages/conversations/{gid}/").status_code == 404
        assert client.get(f"/api/messages/conversations/{gid}/messages/").status_code == 404
        res = client.post(f"/api/messages/conversations/{gid}/messages/", {"body": "hi"}, format="json")
        assert res.status_code == 404
        assert client.post(f"/api/messages/conversations/{gid}/members/", {"user_ids": [org[who].user_id]},
                           format="json").status_code == 404


def test_only_the_owner_changes_membership_and_name(org, client_for):
    alice, bob = client_for(org["alice"]), client_for(org["bob"])
    gid = make_group(alice, "Launch", org["bob"].user, org["manager"].user).data["id"]
    assert bob.post(f"/api/messages/conversations/{gid}/members/", {"user_ids": [org["carol"].user_id]},
                    format="json").status_code == 403
    assert bob.patch(f"/api/messages/conversations/{gid}/", {"name": "Mine now"}, format="json").status_code == 403
    assert bob.delete(f"/api/messages/conversations/{gid}/members/{org['manager'].user_id}/").status_code == 403

    old = send(alice, gid, "Before Carol joined")
    res = alice.post(f"/api/messages/conversations/{gid}/members/", {"user_ids": [org["carol"].user_id]}, format="json")
    assert res.status_code == 200 and res.data["member_count"] == 4
    carol = client_for(org["carol"])
    assert carol.get("/api/messages/conversations/").data["results"][0]["unread_count"] == 0  # history, not unread
    r = alice.get(f"/api/messages/conversations/{gid}/receipts/").data["receipts"][str(old["id"])]
    assert r["recipient_count"] == 2  # Carol joined later: not waited on for older messages
    renamed = alice.patch(f"/api/messages/conversations/{gid}/", {"name": "Launch 2026"}, format="json")
    assert renamed.data["name"] == "Launch 2026"

    assert alice.delete(f"/api/messages/conversations/{gid}/members/{org['carol'].user_id}/").status_code == 200
    assert carol.get(f"/api/messages/conversations/{gid}/messages/").status_code == 404  # removed: no access


def test_leaving_hands_ownership_on(org, client_for):
    alice, bob = client_for(org["alice"]), client_for(org["bob"])
    gid = make_group(alice, "Handover", org["bob"].user, org["manager"].user).data["id"]
    assert alice.delete(f"/api/messages/conversations/{gid}/members/{org['alice'].user_id}/").status_code == 204
    assert alice.get(f"/api/messages/conversations/{gid}/").status_code == 404
    roles = dict(ConversationParticipant.objects.filter(conversation_id=gid).values_list("user_id", "role"))
    assert list(roles.values()).count("OWNER") == 1
    assert bob.get(f"/api/messages/conversations/{gid}/").data["member_count"] == 2


def test_direct_conversations_cannot_be_managed_like_groups(org, client_for):
    alice = client_for(org["alice"])
    cid = start_direct(alice, org["bob"].user)
    assert alice.post(f"/api/messages/conversations/{cid}/members/", {"user_ids": [org["carol"].user_id]},
                      format="json").status_code == 400
    assert Conversation.objects.get(pk=cid).kind == "DIRECT"
