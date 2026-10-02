from rest_framework import serializers

from apps.employees.models import Employee
from apps.employees.serializers import employee_ref

from .models import ComponentKind, PayComponent, PayrollRun, Payslip, PayslipItem, SalaryStructure


class PayComponentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayComponent
        fields = ["id", "name", "code", "kind", "is_active"]

    def validate_code(self, value):
        return value.strip().upper()


class SalaryItemSerializer(serializers.Serializer):
    component = serializers.PrimaryKeyRelatedField(queryset=PayComponent.objects.all())
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)


class SalaryStructureSerializer(serializers.ModelSerializer):
    employee = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all())
    employee_detail = serializers.SerializerMethodField()
    items = SalaryItemSerializer(many=True, required=False)
    gross_earnings = serializers.SerializerMethodField()
    total_deductions = serializers.SerializerMethodField()
    net_pay = serializers.SerializerMethodField()

    class Meta:
        model = SalaryStructure
        fields = [
            "id",
            "employee",
            "employee_detail",
            "effective_from",
            "notes",
            "items",
            "gross_earnings",
            "total_deductions",
            "net_pay",
            "created_at",
        ]

    def get_employee_detail(self, structure):
        return employee_ref(structure.employee)

    def _sum(self, structure, kind):
        return sum((i.amount for i in structure.items.all() if i.component.kind == kind), start=0)

    def get_gross_earnings(self, structure):
        return str(self._sum(structure, ComponentKind.EARNING))

    def get_total_deductions(self, structure):
        return str(self._sum(structure, ComponentKind.DEDUCTION))

    def get_net_pay(self, structure):
        return str(self._sum(structure, ComponentKind.EARNING) - self._sum(structure, ComponentKind.DEDUCTION))

    def to_representation(self, structure):
        data = super().to_representation(structure)
        data["items"] = [
            {
                "component": i.component_id,
                "name": i.component.name,
                "code": i.component.code,
                "kind": i.component.kind,
                "amount": str(i.amount),
            }
            for i in structure.items.all()
        ]
        return data

    def validate_items(self, items):
        ids = [i["component"].pk for i in items]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Each component may appear only once.")
        return items


class PayrollRunSerializer(serializers.ModelSerializer):
    payslip_count = serializers.IntegerField(read_only=True)
    total_net = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = PayrollRun
        fields = [
            "id",
            "year",
            "month",
            "status",
            "currency",
            "payslip_count",
            "total_net",
            "created_at",
            "finalized_at",
        ]
        read_only_fields = ["status", "currency", "created_at", "finalized_at"]


class PayslipItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayslipItem
        fields = ["id", "name", "kind", "amount", "source"]
        read_only_fields = ["source"]

    def validate_amount(self, value):
        if value < 0:
            raise serializers.ValidationError("Must not be negative.")
        return value


class PayslipSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    items = PayslipItemSerializer(many=True, read_only=True)
    year = serializers.IntegerField(source="run.year", read_only=True)
    month = serializers.IntegerField(source="run.month", read_only=True)
    run_status = serializers.CharField(source="run.status", read_only=True)
    currency = serializers.CharField(source="run.currency", read_only=True)

    class Meta:
        model = Payslip
        fields = [
            "id",
            "run",
            "year",
            "month",
            "run_status",
            "currency",
            "employee",
            "gross_earnings",
            "total_deductions",
            "net_pay",
            "items",
        ]
        read_only_fields = fields

    def get_employee(self, payslip):
        emp = payslip.employee
        ref = employee_ref(emp)
        ref["department"] = emp.department.name if emp.department_id else None
        ref["designation"] = emp.designation.name if emp.designation_id else None
        return ref
