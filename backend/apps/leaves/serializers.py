from rest_framework import serializers

from apps.employees.models import Employee
from apps.employees.serializers import employee_ref

from . import services
from .models import LeaveBalance, LeaveBalanceTransaction, LeaveRequest, LeaveType


class LeaveTypeSerializer(serializers.ModelSerializer):
    tracks_balance = serializers.BooleanField(read_only=True)

    class Meta:
        model = LeaveType
        fields = [
            "id",
            "name",
            "code",
            "description",
            "is_paid",
            "annual_allocation",
            "tracks_balance",
            "allow_half_day",
            "is_active",
        ]

    def validate_code(self, value):
        return value.strip().upper()


class LeaveBalanceSerializer(serializers.ModelSerializer):
    employee = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all())
    employee_detail = serializers.SerializerMethodField()
    leave_type_name = serializers.CharField(source="leave_type.name", read_only=True)
    used = serializers.SerializerMethodField()
    pending = serializers.SerializerMethodField()
    available = serializers.SerializerMethodField()

    class Meta:
        model = LeaveBalance
        fields = [
            "id",
            "employee",
            "employee_detail",
            "leave_type",
            "leave_type_name",
            "year",
            "allocated",
            "used",
            "pending",
            "available",
        ]

    def _summary(self, balance):
        cache = self.context.setdefault("_summaries", {})
        if balance.pk not in cache:
            cache[balance.pk] = services.balance_summary(balance.employee, balance.leave_type, balance.year) or {}
        return cache[balance.pk]

    def get_employee_detail(self, balance):
        return employee_ref(balance.employee)

    def get_used(self, balance):
        return self._summary(balance).get("used")

    def get_pending(self, balance):
        return self._summary(balance).get("pending")

    def get_available(self, balance):
        return self._summary(balance).get("available")

    def validate_allocated(self, value):
        if value < 0:
            raise serializers.ValidationError("Must not be negative.")
        if (value * 2) % 1 != 0:
            raise serializers.ValidationError("Use whole or half days.")
        if self.instance is not None:
            used = services.used_days(self.instance)
            if value < used:
                raise serializers.ValidationError(f"Cannot be less than the {used} day(s) already used.")
        return value


class AllocateSerializer(serializers.Serializer):
    leave_type = serializers.PrimaryKeyRelatedField(queryset=LeaveType.objects.filter(is_active=True))
    year = serializers.IntegerField(min_value=2000, max_value=2100)
    allocated = serializers.DecimalField(max_digits=5, decimal_places=1, min_value=0, required=False)
    employees = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all(), many=True, required=False)
    overwrite = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if attrs.get("allocated") is None:
            if attrs["leave_type"].annual_allocation is None:
                raise serializers.ValidationError(
                    {"allocated": ["This leave type has no default allocation; provide one."]}
                )
            attrs["allocated"] = attrs["leave_type"].annual_allocation
        return attrs


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    leave_type_name = serializers.CharField(source="leave_type.name", read_only=True)
    decided_by_name = serializers.CharField(source="decided_by.full_name", read_only=True, default=None)
    can_decide = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()
    is_locked = serializers.BooleanField(read_only=True)
    balance_deducted = serializers.SerializerMethodField()

    class Meta:
        model = LeaveRequest
        fields = [
            "id",
            "employee",
            "leave_type",
            "leave_type_name",
            "start_date",
            "end_date",
            "is_half_day",
            "half_day_period",
            "days",
            "leave_year",
            "reason",
            "status",
            "decided_by_name",
            "decided_at",
            "decision_note",
            "cancelled_at",
            "created_at",
            "can_decide",
            "can_cancel",
            "is_locked",
            "balance_deducted",
        ]
        read_only_fields = fields

    def get_employee(self, leave):
        return employee_ref(leave.employee)

    def get_can_decide(self, leave):
        request = self.context.get("request")
        return bool(
            request and leave.status == LeaveRequest.Status.PENDING and services.can_decide(request.user, leave)
        )


    def get_can_cancel(self, leave):
        request = self.context.get("request")
        return bool(
            request and leave.status == LeaveRequest.Status.PENDING and leave.employee.user_id == request.user.pk
        )

    def get_balance_deducted(self, leave):
        txn = getattr(leave, "balance_transaction", None) if leave.status == LeaveRequest.Status.APPROVED else None
        return txn.days if txn else None


class LeaveBalanceTransactionSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    leave_type_name = serializers.CharField(source="balance.leave_type.name", read_only=True)
    year = serializers.IntegerField(source="balance.year", read_only=True)
    leave_request = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default=None)

    class Meta:
        model = LeaveBalanceTransaction
        fields = ["id", "employee", "leave_type_name", "year", "kind", "days", "balance_before", "balance_after",
                  "leave_request", "created_by_name", "created_at"]
        read_only_fields = fields

    def get_employee(self, txn):
        return employee_ref(txn.balance.employee)

    def get_leave_request(self, txn):
        leave = txn.leave_request
        return {"id": leave.id, "start_date": leave.start_date, "end_date": leave.end_date, "status": leave.status}


class LeaveApplySerializer(serializers.Serializer):
    leave_type = serializers.PrimaryKeyRelatedField(queryset=LeaveType.objects.all())
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    is_half_day = serializers.BooleanField(default=False)
    half_day_period = serializers.ChoiceField(choices=LeaveRequest.Half.choices, required=False, allow_blank=True)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    def validate(self, attrs):
        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError({"end_date": ["End date cannot be before start date."]})
        if attrs["is_half_day"]:
            if attrs["start_date"] != attrs["end_date"]:
                raise serializers.ValidationError({"is_half_day": ["A half-day request must be for a single date."]})
            if not attrs.get("half_day_period"):
                raise serializers.ValidationError({"half_day_period": ["Choose first or second half."]})
        return attrs


class DecisionSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=500)
