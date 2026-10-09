from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.core.permissions import HasPermission

from .models import Notification
from .serializers import NotificationSerializer

UPDATES_LIMIT = 20


class NotificationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Every user sees only their own notifications."""

    serializer_class = NotificationSerializer
    permission_classes = [HasPermission]
    required_permissions = {"*": ()}
    filterset_fields = ["is_read", "type"]

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user)

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        return Response({"count": self.get_queryset().filter(is_read=False).count()})

    @action(detail=False, methods=["get"])
    def updates(self, request):
        """Lightweight poll for desktop alerts: unread notifications created (or refreshed, for
        collapsed message alerts) after `since`, plus the unread counts for the header badges.
        Pass the returned `server_time` as the next `since` so nothing is shown twice."""
        now = timezone.now()
        raw = request.query_params.get("since")
        since = parse_datetime(raw) if raw else None
        if raw and since is None:
            raise ValidationError({"since": ["Use an ISO 8601 date-time."]})
        unread = self.get_queryset().filter(is_read=False)
        fresh = unread.filter(created_at__gt=since, created_at__lte=now)[:UPDATES_LIMIT] if since else []
        messages = None
        if request.user.has_permission("messages.use"):
            from apps.messaging.services import mark_delivered, unread_total

            mark_delivered(request.user)  # the app is open: new messages reached this person
            messages = unread_total(request.user)
        return Response(
            {
                "server_time": serializers.DateTimeField().to_representation(now),
                "notifications": self.get_serializer(fresh, many=True).data,
                "unread_notifications": unread.count(),
                "unread_messages": messages,
            }
        )

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        if not notification.is_read:
            notification.is_read = True
            notification.read_at = timezone.now()
            notification.save(update_fields=["is_read", "read_at"])
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        updated = self.get_queryset().filter(is_read=False).update(is_read=True, read_at=timezone.now())
        return Response({"updated": updated})
