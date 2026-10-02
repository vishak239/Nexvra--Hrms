from django.db.models import ProtectedError
from rest_framework import viewsets

from apps.audit import services as audit
from apps.core.exceptions import Conflict


class AuditedModelViewSet(viewsets.ModelViewSet):
    """CRUD with audit records; deleting rows that are still referenced returns 409."""

    audit_name = ""

    def perform_create(self, serializer):
        obj = serializer.save()
        audit.record(self.request, f"{self.audit_name}_CREATED", obj=obj, changes=serializer.validated_data)

    def perform_update(self, serializer):
        fields = list(serializer.validated_data)
        before = audit.snapshot(serializer.instance, fields)
        obj = serializer.save()
        audit.record(
            self.request, f"{self.audit_name}_UPDATED", obj=obj, changes=audit.diff(before, audit.snapshot(obj, fields))
        )

    def perform_destroy(self, obj):
        label = str(obj)
        try:
            obj.delete()
        except ProtectedError:
            raise Conflict("This record is in use. Deactivate it instead.") from None
        audit.record(self.request, f"{self.audit_name}_DELETED", metadata={"name": label})
