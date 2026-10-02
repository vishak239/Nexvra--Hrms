from rest_framework import serializers

from apps.employees.models import Employee
from apps.employees.serializers import employee_ref

from .models import EmployeeDocument


class EmployeeDocumentSerializer(serializers.ModelSerializer):
    employee_detail = serializers.SerializerMethodField()
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True, default=None)

    class Meta:
        model = EmployeeDocument
        fields = [
            "id",
            "employee",
            "employee_detail",
            "category",
            "title",
            "original_filename",
            "content_type",
            "size",
            "visible_to_employee",
            "uploaded_by_name",
            "created_at",
        ]
        read_only_fields = fields

    def get_employee_detail(self, doc):
        return employee_ref(doc.employee)

    def to_representation(self, doc):
        data = super().to_representation(doc)
        request = self.context.get("request")
        if request and not request.user.has_permission("documents.view_all"):
            data.pop("visible_to_employee", None)
        return data


class DocumentUploadSerializer(serializers.Serializer):
    employee = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all())
    category = serializers.ChoiceField(choices=EmployeeDocument.Category.choices)
    title = serializers.CharField(max_length=200)
    file = serializers.FileField()
    visible_to_employee = serializers.BooleanField(default=True)


class DocumentUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeDocument
        fields = ["category", "title", "visible_to_employee"]
