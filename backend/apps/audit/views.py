import django_filters
from rest_framework import viewsets

from apps.core.permissions import HasPermission

from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    action = django_filters.CharFilter(lookup_expr="iexact")

    class Meta:
        model = AuditLog
        fields = ["actor", "action", "entity_type", "entity_id"]


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only by design: there is no API to change or delete audit records."""

    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [HasPermission]
    required_permissions = {"*": ("audit.view",)}
    filterset_class = AuditLogFilter
    search_fields = ["actor_email", "action", "entity_type"]
