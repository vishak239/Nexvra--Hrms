from rest_framework import serializers

from apps.employees.models import Employee
from apps.employees.serializers import employee_ref
from apps.organization.models import CompanySettings

from .models import AttendanceRecord, BreakSession, OvertimeSession, SyncEvent, WorkFromHomeRequest


class AttendanceRecordSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    worked_minutes = serializers.IntegerField(read_only=True)
    session_minutes = serializers.IntegerField(read_only=True)
    break_minutes = serializers.IntegerField(read_only=True)
    break_over_allowance_minutes = serializers.SerializerMethodField()

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
            "break_over_allowance_minutes",
            "mode",
            "checkout_reason",
            "check_in_distance_m",
            "check_out_distance_m",
            "last_activity_at",
            "location_issue",
            "source",
            "remarks",
            "updated_at",
        ]
        read_only_fields = fields

    def get_employee(self, record):
        return employee_ref(record.employee)

    def get_break_over_allowance_minutes(self, record):
        """Break time beyond the configured daily allowance; None when no allowance is set."""
        if "break_allowance" not in self.context:  # one settings read per response, not per row
            self.context["break_allowance"] = CompanySettings.get_solo().break_allowance_minutes
        allowance = self.context["break_allowance"]
        if allowance is None:
            return None
        return max(0, record.break_minutes - allowance)


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
                  "end_reason", "source", "created_at"]
        read_only_fields = fields

    def get_employee(self, session):
        return employee_ref(session.employee)


class OvertimeSessionSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    tasks = serializers.SerializerMethodField()
    decided_by_name = serializers.CharField(source="decided_by.full_name", read_only=True, default=None)

    class Meta:
        model = OvertimeSession
        fields = ["id", "employee", "attendance", "date", "started_at", "ended_at", "duration_seconds", "status",
                  "trigger", "source", "tasks", "work_description", "other_reason", "declaration_confirmed",
                  "requested_at", "decided_by_name", "decided_at", "decision_note", "end_reason",
                  "last_activity_at", "created_at", "updated_at"]
        read_only_fields = fields

    def get_employee(self, session):
        return employee_ref(session.employee)

    def get_tasks(self, session):
        return [{"id": t.pk, "title": t.title, "priority": t.priority, "status": t.status} for t in session.tasks.all()]


class OvertimeRequestSerializer(serializers.Serializer):
    """The overtime declaration. Server-controlled fields (times, status, approval) are not
    accepted from the client at all."""

    task_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), max_length=20, required=False,
                                     default=list)
    use_other_reason = serializers.BooleanField(required=False, default=False)
    other_reason = serializers.CharField(required=False, allow_blank=True, max_length=2000, default="")
    work_description = serializers.CharField(max_length=2000)
    declaration_confirmed = serializers.BooleanField()

    def validate_work_description(self, value):
        value = value.strip()
        if len(value) < 10:
            raise serializers.ValidationError("Describe what you will work on (at least 10 characters).")
        return value

    def validate(self, attrs):
        errors = {}
        other = attrs.get("other_reason", "").strip()
        if not attrs.get("task_ids") and not attrs.get("use_other_reason"):
            errors["task_ids"] = ["Select at least one pending task, or choose Other reason."]
        if attrs.get("use_other_reason") and len(other) < 15:
            errors["other_reason"] = ["Explain the other reason in detail (at least 15 characters)."]
        if attrs.get("declaration_confirmed") is not True:
            errors["declaration_confirmed"] = ["Confirm that this work is the reason for your overtime."]
        if errors:
            raise serializers.ValidationError(errors)
        attrs["other_reason"] = other if attrs.get("use_other_reason") else ""
        return attrs


class DecisionSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=500, default="")


class WorkFromHomeRequestSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    decided_by_name = serializers.CharField(source="decided_by.full_name", read_only=True, default=None)

    class Meta:
        model = WorkFromHomeRequest
        fields = ["id", "employee", "date", "reason", "remarks", "status", "decided_by_name", "decided_at",
                  "decision_note", "cancelled_at", "created_at"]
        read_only_fields = ["id", "employee", "status", "decided_by_name", "decided_at", "decision_note",
                            "cancelled_at", "created_at"]

    def get_employee(self, wfh):
        return employee_ref(wfh.employee)

    def validate_reason(self, value):
        value = value.strip()
        if len(value) < 5:
            raise serializers.ValidationError("Give a reason (at least 5 characters).")
        return value


class LocationFieldsMixin(serializers.Serializer):
    latitude = serializers.FloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    longitude = serializers.FloatField(required=False, allow_null=True, min_value=-180, max_value=180)
    accuracy = serializers.FloatField(required=False, allow_null=True, min_value=0, max_value=100000)

    def validate(self, attrs):
        if (attrs.get("latitude") is None) != (attrs.get("longitude") is None):
            raise serializers.ValidationError({"latitude": ["Send both latitude and longitude."]})
        return attrs


class CheckInSerializer(LocationFieldsMixin):
    """Unknown fields (e.g. a client-side "inside_radius" flag or distance) are ignored."""

    mode = serializers.ChoiceField(choices=AttendanceRecord.Mode.choices, default=AttendanceRecord.Mode.OFFICE)


class CheckOutSerializer(LocationFieldsMixin):
    pass


class HeartbeatSerializer(LocationFieldsMixin):
    idle_seconds = serializers.IntegerField(min_value=0, max_value=86400)
    location_status = serializers.ChoiceField(
        choices=["ok", "denied", "unavailable", "timeout", "unsupported", "not_requested"], default="not_requested"
    )


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
