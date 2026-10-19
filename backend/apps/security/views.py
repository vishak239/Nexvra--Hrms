import django_filters
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import HasPermission, scope_queryset

from . import services
from .models import SecurityEvent
from .serializers import SecurityEventReviewSerializer, SecurityEventSerializer


class SecurityEventFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    risk_level = django_filters.ChoiceFilter(choices=SecurityEvent.RiskLevel.choices)
    review_status = django_filters.ChoiceFilter(choices=SecurityEvent.ReviewStatus.choices)
    kind = django_filters.ChoiceFilter(choices=SecurityEvent.Kind.choices)

    class Meta:
        model = SecurityEvent
        fields = ["user", "employee", "kind", "risk_level", "review_status", "ip_address"]


class SecurityEventViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Reviewable suspicious-login events. HR / Super Admin (audit.view) can list, filter and
    review them. Employees cannot see another user's events.
    """

    serializer_class = SecurityEventSerializer
    permission_classes = [HasPermission]
    required_permissions = {"*": ("audit.view",)}
    filterset_class = SecurityEventFilter
    search_fields = ["user__email", "user__username", "ip_address", "kind", "risk_level"]
    ordering_fields = ["created_at", "risk_level", "review_status"]

    def get_queryset(self):
        qs = SecurityEvent.objects.select_related("user", "employee", "reviewed_by__user")
        return scope_queryset(qs, self.request.user, "audit", employee_path="employee")

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        event = self.get_object()
        ser = SecurityEventReviewSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        event = services.review_event(
            event, request.user, ser.validated_data["review_status"], ser.validated_data.get("resolution_note", "")
        )
        return Response(SecurityEventSerializer(event).data, status=status.HTTP_200_OK)
