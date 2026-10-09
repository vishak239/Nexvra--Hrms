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
        "photo_version": emp.photo_version if emp else None,
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
    sender = serializers.SerializerMethodField()
    attachments = AttachmentSerializer(many=True, read_only=True)
    is_mine = serializers.SerializerMethodField()
    receipt = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id", "conversation", "sender_id", "sender", "body", "attachments", "created_at", "is_mine", "receipt",
        ]
        read_only_fields = fields

    def get_is_mine(self, message):
        request = self.context.get("request")
        return bool(request and message.sender_id == request.user.pk)

    def get_sender(self, message):
        return person(message.sender) if message.sender_id else None

    def get_receipt(self, message):
        """Delivery / seen status, only on the caller's own messages."""
        return (self.context.get("receipts") or {}).get(message.id)


class StartConversationSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()


class SendMessageSerializer(serializers.Serializer):
    body = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False, max_length=5000)
    files = serializers.ListField(child=serializers.FileField(), required=False, allow_empty=True)


def _user_ids(value):
    ids = list(dict.fromkeys(value))
    if not ids:
        raise serializers.ValidationError("Choose at least one colleague.")
    return ids


class CreateGroupSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    user_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), max_length=100)

    def validate_user_ids(self, value):
        return _user_ids(value)


class RenameGroupSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)


class MembersSerializer(serializers.Serializer):
    user_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), max_length=100)

    def validate_user_ids(self, value):
        return _user_ids(value)
