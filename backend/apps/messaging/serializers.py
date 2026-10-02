from rest_framework import serializers

from .models import Message, MessageAttachment


def person(user):
    """Minimal directory card: enough to recognise a colleague, nothing confidential."""
    if user is None:
        return None
    emp = getattr(user, "employee", None)
    return {
        "user_id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "employee_id": emp.id if emp else None,
        "employee_code": emp.employee_code if emp else None,
        "designation": emp.designation.name if emp and emp.designation_id else None,
        "department": emp.department.name if emp and emp.department_id else None,
        "has_photo": bool(emp and emp.photo),
    }


class AttachmentSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = MessageAttachment
        fields = ["id", "original_filename", "content_type", "size", "created_at", "download_url"]
        read_only_fields = fields

    def get_download_url(self, attachment):
        return f"/api/messages/attachments/{attachment.id}/download/"


class MessageSerializer(serializers.ModelSerializer):
    sender_id = serializers.IntegerField(read_only=True)
    attachments = AttachmentSerializer(many=True, read_only=True)
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ["id", "conversation", "sender_id", "body", "attachments", "created_at", "is_mine"]
        read_only_fields = fields

    def get_is_mine(self, message):
        request = self.context.get("request")
        return bool(request and message.sender_id == request.user.pk)


class StartConversationSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()


class SendMessageSerializer(serializers.Serializer):
    body = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False, max_length=5000)
    files = serializers.ListField(child=serializers.FileField(), required=False, allow_empty=True)
