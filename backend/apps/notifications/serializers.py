from rest_framework import serializers

from .models import Notification
from .services import link_for


class NotificationSerializer(serializers.ModelSerializer):
    link = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            "id",
            "type",
            "title",
            "message",
            "entity_type",
            "entity_id",
            "link",
            "is_read",
            "read_at",
            "created_at",
        ]
        read_only_fields = fields

    def get_link(self, notification):
        return link_for(notification)
