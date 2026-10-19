from rest_framework import serializers

from apps.employees.serializers import employee_ref

from .models import SecurityEvent


class SecurityEventSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    actor_email = serializers.CharField(source="user.email", read_only=True)

    class Meta:
        model = SecurityEvent
        fields = [
            "id", "user", "employee", "actor_email", "kind", "risk_level", "ip_address", "user_agent",
            "metadata", "created_at", "review_status", "reviewed_by", "reviewed_at", "resolution_note",
        ]
        read_only_fields = fields

    def get_employee(self, event):
        if event.employee is None:
            return None
        return employee_ref(event.employee)


class SecurityEventReviewSerializer(serializers.Serializer):
    review_status = serializers.ChoiceField(
        choices=[
            SecurityEvent.ReviewStatus.REVIEWED,
            SecurityEvent.ReviewStatus.DISMISSED,
            SecurityEvent.ReviewStatus.ESCALATED,
        ]
    )
    resolution_note = serializers.CharField(required=False, allow_blank=True, max_length=500, default="")
