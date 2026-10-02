from rest_framework import serializers

from apps.employees.models import Employee
from apps.employees.serializers import employee_ref

from .models import AttendanceRecord, BreakSession, OvertimeSession, SyncEvent


class AttendanceRecordSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    worked_minutes = serializers.IntegerField(read_only=True)
    session_minutes = serializers.IntegerField(read_only=True)
    break_minutes = serializers.IntegerField(read_only=True)

    class Meta:
        model = AttendanceRecord
        fields = [
            "id",
            "employee",
            "date",
            "check_in",
            "check_out",
            "status",
            "is_late",
            "worked_minutes",
            "session_minutes",
            "break_minutes",
            "total_break_seconds",
            "source",
            "remarks",
            "updated_at",
        ]
        read_only_fields = fields

    def get_employee(self, record):
        return employee_ref(record.employee)


class AttendanceAdminSerializer(serializers.ModelSerializer):
    employee = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all())
    status = serializers.ChoiceField(choices=AttendanceRecord.Status.choices, required=False)

    class Meta:
        model = AttendanceRecord
        fields = ["employee", "date", "check_in", "check_out", "status", "remarks"]

    def validate(self, attrs):
        check_in = attrs.get("check_in", getattr(self.instance, "check_in", None))
        check_out = attrs.get("check_out", getattr(self.instance, "check_out", None))
        if check_out and not check_in:
            raise serializers.ValidationError({"check_out": ["Check-out requires a check-in."]})
        if check_in and check_out and check_out < check_in:
            raise serializers.ValidationError({"check_out": ["Check-out must be after check-in."]})
        if self.instance is not None and "employee" in attrs and attrs["employee"] != self.instance.employee:
            raise serializers.ValidationError({"employee": ["Cannot move a record to another employee."]})
        return attrs


class BreakSessionSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    date = serializers.DateField(source="attendance.date", read_only=True)

    class Meta:
        model = BreakSession
        fields = ["id", "employee", "attendance", "date", "started_at", "ended_at", "duration_seconds", "status",
                  "source", "created_at"]
        read_only_fields = fields

    def get_employee(self, session):
        return employee_ref(session.employee)


class OvertimeSessionSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()

    class Meta:
        model = OvertimeSession
        fields = ["id", "employee", "attendance", "date", "started_at", "ended_at", "duration_seconds", "status",
                  "trigger", "source", "created_at", "updated_at"]
        read_only_fields = fields

    def get_employee(self, session):
        return employee_ref(session.employee)


class SyncEventSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()

    class Meta:
        model = SyncEvent
        fields = ["id", "employee", "client_event_id", "event_type", "channel", "client_timestamp", "effective_at",
                  "received_at", "status", "error"]
        read_only_fields = fields

    def get_employee(self, event):
        return employee_ref(event.employee)


class EventIdSerializer(serializers.Serializer):
    """Optional client UUID making an online break/overtime call idempotent on retry."""

    client_event_id = serializers.UUIDField(required=False)


class OfflineEventSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    type = serializers.ChoiceField(choices=SyncEvent.Type.choices)
    occurred_at = serializers.DateTimeField()


class SyncRequestSerializer(serializers.Serializer):
    events = OfflineEventSerializer(many=True, allow_empty=True)

    def validate_events(self, events):
        from .sessions import MAX_EVENTS_PER_SYNC

        if len(events) > MAX_EVENTS_PER_SYNC:
            raise serializers.ValidationError(f"Send at most {MAX_EVENTS_PER_SYNC} events per request.")
        ids = [e["id"] for e in events]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Event ids must be unique.")
        return events
