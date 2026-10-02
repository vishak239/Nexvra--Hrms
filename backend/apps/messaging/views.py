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
from .serializers import MessageSerializer, SendMessageSerializer, StartConversationSerializer, person

PAGE = 30


class MessagingViewSet(viewsets.GenericViewSet):
    """Private 1:1 messaging. Every query is restricted to conversations the caller takes part
    in, so other conversations (and their files) are 404 - guessing ids does not help."""

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

    def _conversation_data(self, conversation, last_messages=None):
        other = services.other_participant(conversation, self.request.user)
        last = (last_messages or {}).get(getattr(conversation, "last_message_id", None))
        if last is None and last_messages is None and getattr(conversation, "last_message_id", None):
            last = Message.objects.filter(pk=conversation.last_message_id).prefetch_related("attachments").first()
        return {
            "id": conversation.id,
            "other": person(other),
            "unread_count": getattr(conversation, "unread_count", 0) or 0,
            "last_message_at": conversation.last_message_at,
            "last_message": (
                {
                    "id": last.id,
                    "body": last.body[:140],
                    "is_mine": last.sender_id == self.request.user.pk,
                    "attachment_count": len(last.attachments.all()),
                    "created_at": last.created_at,
                }
                if last
                else None
            ),
            "created_at": conversation.created_at,
        }

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

        qs = services.conversations_for(request.user).filter(last_message_at__isnull=False)
        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except ValueError:
            page = 1
        total = qs.count()
        rows = list(qs.order_by("-last_message_at", "-id")[(page - 1) * PAGE: page * PAGE])
        last_ids = [c.last_message_id for c in rows if c.last_message_id]
        last_messages = {m.id: m for m in Message.objects.filter(pk__in=last_ids).prefetch_related("attachments")}
        return Response(
            {
                "count": total,
                "page": page,
                "page_size": PAGE,
                "results": [self._conversation_data(c, last_messages) for c in rows],
            }
        )

    @action(detail=False, methods=["get"], url_path=r"conversations/(?P<conversation_id>\d+)")
    def conversation(self, request, conversation_id=None):
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
            message = Message.objects.prefetch_related("attachments").get(pk=message.pk)
            data = MessageSerializer(message, context={"request": request}).data
            return Response(data, status=status.HTTP_201_CREATED)

        # Newest page first; `before=<message id>` loads older history. Returned oldest -> newest.
        qs = Message.objects.filter(conversation=conversation).prefetch_related("attachments").order_by("-id")
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
        return Response(
            {
                "results": MessageSerializer(rows, many=True, context={"request": request}).data,
                "has_more": has_more,
            }
        )

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
