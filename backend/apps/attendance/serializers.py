from rest_framework import serializers

from apps.employees.models import Employee
from apps.employees.serializers import employee_ref

from .models import AttendanceRecord


class AttendanceRecordSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    worked_minutes = serializers.IntegerField(read_only=True)

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
