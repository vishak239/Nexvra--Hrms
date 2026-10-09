from django.http import Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.accounts.models import User
from apps.core.files import private_file_response
from apps.core.permissions import HasPermission

from . import services
from .models import Message, MessageAttachment
from .serializers import (
    CreateGroupSerializer,
    MembersSerializer,
    MessageSerializer,
    RenameGroupSerializer,
    SendMessageSerializer,
    StartConversationSerializer,
    person,
)

PAGE = 30
RECEIPT_WINDOW = 50


class MessagingViewSet(viewsets.GenericViewSet):
    """Private messaging (one-to-one and groups). Every query is restricted to conversations the
    caller is a member of, so other conversations (and their files and receipts) are 404 -
    guessing ids does not help."""

    permission_classes = [HasPermission]
    required_permissions = {"*": ("messages.use",)}
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    pagination_class = None

    def _conversation(self, pk):
        try:
            return services.conversations_for(self.request.user).get(pk=int(pk))
        except (ValueError, TypeError):
            raise Http404 from None
        except services.Conversation.DoesNotExist:
            raise Http404 from None

    def _messages_qs(self, conversation):
        return Message.objects.filter(conversation=conversation).select_related(
            "sender__employee__designation", "sender__employee__department"
        ).prefetch_related("attachments")

    def _conversation_data(self, conversation, last_messages=None):
        user = self.request.user
        other = services.other_participant(conversation, user)
        mine = services.membership(conversation, user)
        last = (last_messages or {}).get(getattr(conversation, "last_message_id", None))
        if last is None and last_messages is None and getattr(conversation, "last_message_id", None):
            last = Message.objects.filter(pk=conversation.last_message_id).select_related("sender").prefetch_related(
                "attachments"
            ).first()
        members = sorted(conversation.memberships.all(), key=lambda m: (m.role != "OWNER", m.user.full_name.lower()))
        return {
            "id": conversation.id,
            "kind": conversation.kind,
            "name": conversation.name if conversation.is_group else (other.full_name if other else ""),
            "other": person(other),
            "members": [{**person(m.user), "role": m.role} for m in members] if conversation.is_group else [],
            "member_count": len(members),
            "my_role": mine.role if mine else None,
            "unread_count": getattr(conversation, "unread_count", 0) or 0,
            "last_message_at": conversation.last_message_at,
            "last_message": (
                {
                    "id": last.id,
                    "body": last.body[:140],
                    "is_mine": last.sender_id == user.pk,
                    "sender_name": last.sender.first_name if last.sender_id and last.sender else "",
                    "attachment_count": len(last.attachments.all()),
                    "created_at": last.created_at,
                }
                if last
                else None
            ),
            "created_at": conversation.created_at,
        }

    def _messages_data(self, conversation, rows):
        receipts = services.receipts(conversation, rows, self.request.user)
        return MessageSerializer(rows, many=True, context={"request": self.request, "receipts": receipts}).data

    @action(detail=False, methods=["get", "post"])
    def conversations(self, request):
        if request.method == "POST":
            ser = StartConversationSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            other = User.objects.filter(pk=ser.validated_data["user_id"]).first()
            if other is None:
                raise ValidationError({"user_id": ["This person was not found."]})
            conversation, created = services.get_or_create_conversation(request.user, other)
            conversation = self._conversation(conversation.pk)
            return Response(
                self._conversation_data(conversation), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
            )

        services.mark_delivered(request.user)
        # Groups appear as soon as they exist; direct conversations once the first message is sent.
        qs = services.conversations_for(request.user).exclude(kind="DIRECT", last_message_at__isnull=True)
        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except ValueError:
            page = 1
        total = qs.count()
        rows = list(qs.order_by("-last_message_at", "-created_at", "-id")[(page - 1) * PAGE: page * PAGE])
        last_ids = [c.last_message_id for c in rows if c.last_message_id]
        last_qs = Message.objects.filter(pk__in=last_ids).select_related("sender").prefetch_related("attachments")
        last_messages = {m.id: m for m in last_qs}
        return Response(
            {
                "count": total,
                "page": page,
                "page_size": PAGE,
                "results": [self._conversation_data(c, last_messages) for c in rows],
            }
        )

    @action(detail=False, methods=["post"])
    def groups(self, request):
        ser = CreateGroupSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        conversation = services.create_group(request.user, ser.validated_data["name"], ser.validated_data["user_ids"])
        return Response(self._conversation_data(self._conversation(conversation.pk)), status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get", "patch"], url_path=r"conversations/(?P<conversation_id>\d+)")
    def conversation(self, request, conversation_id=None):
        conversation = self._conversation(conversation_id)
        if request.method == "PATCH":
            ser = RenameGroupSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            services.rename_group(request.user, conversation, ser.validated_data["name"])
            conversation = self._conversation(conversation_id)
        return Response(self._conversation_data(conversation))

    @action(detail=False, methods=["post"], url_path=r"conversations/(?P<conversation_id>\d+)/members")
    def add_members(self, request, conversation_id=None):
        conversation = self._conversation(conversation_id)
        ser = MembersSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        services.add_members(request.user, conversation, ser.validated_data["user_ids"])
        return Response(self._conversation_data(self._conversation(conversation_id)))

    @action(
        detail=False, methods=["delete"], url_path=r"conversations/(?P<conversation_id>\d+)/members/(?P<user_id>\d+)"
    )
    def remove_member(self, request, conversation_id=None, user_id=None):
        conversation = self._conversation(conversation_id)
        services.remove_member(request.user, conversation, int(user_id))
        if int(user_id) == request.user.pk:
            return Response(status=status.HTTP_204_NO_CONTENT)  # left the group
        return Response(self._conversation_data(self._conversation(conversation_id)))

    @action(
        detail=False,
        methods=["get", "post"],
        url_path=r"conversations/(?P<conversation_id>\d+)/messages",
    )
    def messages(self, request, conversation_id=None):
        conversation = self._conversation(conversation_id)
        if request.method == "POST":
            ser = SendMessageSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            files = request.FILES.getlist("files") if hasattr(request, "FILES") else []
            message = services.send(request.user, conversation, ser.validated_data.get("body", ""), files)
            conversation = self._conversation(conversation_id)
            rows = list(self._messages_qs(conversation).filter(pk=message.pk))
            return Response(self._messages_data(conversation, rows)[0], status=status.HTTP_201_CREATED)

        services.mark_delivered(request.user)
        # Newest page first; `before=<message id>` loads older history. Returned oldest -> newest.
        qs = self._messages_qs(conversation).order_by("-id")
        before = request.query_params.get("before")
        if before:
            if not before.isdigit():
                raise ValidationError({"before": ["Must be a message id."]})
            qs = qs.filter(id__lt=int(before))
        after = request.query_params.get("after")
        if after:
            if not after.isdigit():
                raise ValidationError({"after": ["Must be a message id."]})
            qs = qs.filter(id__gt=int(after))
        rows = list(qs[: PAGE + 1])
        has_more = len(rows) > PAGE and not after
        rows = rows[:PAGE]
        rows.reverse()
        return Response({"results": self._messages_data(conversation, rows), "has_more": has_more})

    @action(detail=False, methods=["get"], url_path=r"conversations/(?P<conversation_id>\d+)/receipts")
    def receipts(self, request, conversation_id=None):
        """Delivery / seen status of the caller's latest messages (no contents)."""
        conversation = self._conversation(conversation_id)
        rows = list(
            Message.objects.filter(conversation=conversation, sender=request.user).order_by("-id")[:RECEIPT_WINDOW]
        )
        data = services.receipts(conversation, rows, request.user)
        return Response({"receipts": {str(k): v for k, v in data.items()}})

    @action(detail=False, methods=["post"], url_path=r"conversations/(?P<conversation_id>\d+)/read")
    def read(self, request, conversation_id=None):
        conversation = self._conversation(conversation_id)
        last = services.mark_read(request.user, conversation)
        return Response({"last_read_message_id": last})

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        return Response({"count": services.unread_total(request.user)})

    @action(detail=False, methods=["get"])
    def people(self, request):
        users = services.directory(request.user, request.query_params.get("q", ""))
        return Response({"results": [person(u) for u in users]})

    @action(detail=False, methods=["get"], url_path=r"attachments/(?P<attachment_id>\d+)/download")
    def download(self, request, attachment_id=None):
        attachment = (
            MessageAttachment.objects.filter(
                pk=int(attachment_id), message__conversation__memberships__user=request.user
            )
            .select_related("message")
            .first()
        )
        if attachment is None:
            raise Http404
        return private_file_response(attachment.file, attachment.original_filename, attachment.content_type)
