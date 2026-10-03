from rest_framework import serializers

from .models import Company, CompanySettings, Department, Designation, Holiday, Policy


class CompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ["name", "legal_name", "email", "phone", "website", "address", "updated_at"]
        read_only_fields = ["updated_at"]


class CompanySettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanySettings
        fields = [
            "timezone",
            "currency",
            "working_days",
            "work_start_time",
            "work_end_time",
            "late_grace_minutes",
            "break_allowance_minutes",
            "half_day_min_hours",
            "full_day_min_hours",
            "self_attendance_enabled",
            "leave_year_start_month",
            "employee_document_upload_enabled",
            "deactivate_user_on_exit",
            "max_upload_size_mb",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]

    def validate_currency(self, value):
        value = (value or "").upper()
        if value and (len(value) != 3 or not value.isalpha()):
            raise serializers.ValidationError("Use a 3-letter ISO 4217 code.")
        return value

    def validate_working_days(self, value):
        return sorted(value) if value else value

    def validate(self, attrs):
        merged = {f: attrs.get(f, getattr(self.instance, f, None)) for f in self.Meta.fields if f != "updated_at"}
        half, full = merged["half_day_min_hours"], merged["full_day_min_hours"]
        if (half is None) != (full is None):
            raise serializers.ValidationError(
                {"half_day_min_hours": ["Set both half-day and full-day minimum hours, or neither."]}
            )
        if half is not None and half >= full:
            raise serializers.ValidationError({"half_day_min_hours": ["Must be less than full-day minimum hours."]})
        start, end = merged["work_start_time"], merged["work_end_time"]
        if start and end and end <= start:
            raise serializers.ValidationError({"work_end_time": ["Must be after work start time."]})
        return attrs


class DepartmentSerializer(serializers.ModelSerializer):
    head_name = serializers.CharField(source="head.user.full_name", read_only=True, default=None)
    employee_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Department
        fields = ["id", "name", "code", "description", "head", "head_name", "is_active", "employee_count"]

    def validate_code(self, value):
        return value.strip().upper()


class DesignationSerializer(serializers.ModelSerializer):
    employee_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Designation
        fields = ["id", "name", "description", "is_active", "employee_count"]


class HolidaySerializer(serializers.ModelSerializer):
    class Meta:
        model = Holiday
        fields = ["id", "date", "name", "is_optional"]


class PolicySerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source="get_category_display", read_only=True)
    updated_by_name = serializers.CharField(source="updated_by.full_name", read_only=True, default=None)

    class Meta:
        model = Policy
        fields = [
            "id",
            "title",
            "category",
            "category_label",
            "body",
            "effective_date",
            "is_published",
            "updated_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "category_label", "updated_by_name", "created_at", "updated_at"]
        extra_kwargs = {"body": {"max_length": 20000}}

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a title.")
        clash = Policy.objects.filter(title__iexact=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("A policy with this title already exists.")
        return value

    def validate_body(self, value):
        if not value.strip():
            raise serializers.ValidationError("Enter the policy text.")
        return value.strip()
