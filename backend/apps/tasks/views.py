import django_filters
from django.db.models import Q
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import HasPermission, scope_queryset
from apps.employees.serializers import employee_ref
from apps.organization.models import CompanySettings

from . import rules, services
from .models import Task
from .serializers import (
    TaskCancelSerializer,
    TaskCompleteSerializer,
    TaskCreateSerializer,
    TaskDetailSerializer,
    TaskMessageSerializer,
    TaskSerializer,
    TaskUpdateSerializer,
)


class TaskFilter(django_filters.FilterSet):
    status = django_filters.CharFilter(method="filter_status")
    due_from = django_filters.DateFilter(field_name="due_date", lookup_expr="gte")
    due_to = django_filters.DateFilter(field_name="due_date", lookup_expr="lte")
    created_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    created_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    mine = django_filters.BooleanFilter(method="filter_mine")

    class Meta:
        model = Task
        fields = ["priority", "assigned_to", "requires_response"]

    def filter_status(self, queryset, name, value):
        today = CompanySettings.get_solo().today()
        open_q = Q(status__in=Task.OPEN_STATUSES)
        overdue_q = open_q & Q(due_date__lt=today)
        if value == Task.OVERDUE:
            return queryset.filter(overdue_q)
        if value == "OPEN":
            return queryset.filter(open_q)
        if value in Task.Status.values:
            return queryset.filter(status=value)
        return queryset.none()

    def filter_mine(self, queryset, name, value):
        user = self.request.user
        return queryset.filter(assigned_to__user=user) if value else queryset.exclude(assigned_to__user=user)


class TaskViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Employees see the tasks assigned to them; managers also their direct reports' tasks
    (tasks.view_team); HR / Super Admin see all (tasks.view_all). Objects outside that scope
    return 404. Assignee-only and manager-only actions are re-checked in the services."""

    permission_classes = [HasPermission]
    required_permissions = {
        "list": (),
        "retrieve": (),
        "blocking": (),
        "start": (),
        "respond": (),
        "complete": (),
        "create": ("tasks.manage",),
        "update": ("tasks.manage",),
        "partial_update": ("tasks.manage",),
        "cancel": ("tasks.manage",),
        "remind": ("tasks.manage",),
        "lookup": ("tasks.manage",),
    }
    filterset_class = TaskFilter
    search_fields = ["title", "assigned_to__employee_code", "assigned_to__user__username",
                     "assigned_to__user__first_name", "assigned_to__user__last_name"]
    ordering_fields = ["created_at", "due_date", "priority", "status"]
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        qs = Task.objects.select_related("assigned_to__user", "assigned_by")
        if self.action == "retrieve":
            qs = qs.prefetch_related("responses__author")
        return scope_queryset(qs, self.request.user, "tasks", employee_path="assigned_to")

    def get_serializer_class(self):
        return TaskDetailSerializer if self.action == "retrieve" else TaskSerializer

    def _detail(self, task, **kwargs):
        task = self.get_queryset().prefetch_related("responses__author").get(pk=task.pk)
        return Response(TaskDetailSerializer(task, context=self.get_serializer_context()).data, **kwargs)

    def create(self, request, *args, **kwargs):
        ser = TaskCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        task = services.create(request, ser.validated_data)
        return self._detail(task, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        task = self.get_object()
        ser = TaskUpdateSerializer(data=request.data, partial=kwargs.pop("partial", False))
        ser.is_valid(raise_exception=True)
        task = services.update(request, task, ser.validated_data)
        return self._detail(task)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        ser = TaskCancelSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return self._detail(services.cancel(request, self.get_object(), ser.validated_data.get("reason", "")))

    @action(detail=True, methods=["post"])
    def remind(self, request, pk=None):
        return self._detail(services.remind(request, self.get_object()))

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        return self._detail(services.start(request, self.get_object()))

    @action(detail=True, methods=["post"])
    def respond(self, request, pk=None):
        ser = TaskMessageSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return self._detail(services.respond(request, self.get_object(), ser.validated_data["message"]))

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        ser = TaskCompleteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return self._detail(services.complete(request, self.get_object(), ser.validated_data.get("message", "")))

    @action(detail=False, methods=["get"])
    def blocking(self, request):
        """Tasks that currently stop the caller from checking out (see apps/tasks/rules.py)."""
        tasks = rules.blocking_tasks(request.user).select_related("assigned_to__user", "assigned_by")
        data = TaskSerializer(tasks.order_by("created_at"), many=True, context=self.get_serializer_context()).data
        return Response({"exempt": rules.is_exempt(request.user), "count": len(data), "results": data})

    @action(detail=False, methods=["get"])
    def lookup(self, request):
        """Confirm who an Employee ID or @username refers to before assigning (HR)."""
        employee, looked_up_by = services.resolve_assignee(
            request.query_params.get("employee_code"), request.query_params.get("username")
        )
        return Response(
            {
                "looked_up_by": looked_up_by,
                "employee": {
                    **employee_ref(employee),
                    "department": employee.department.name if employee.department_id else None,
                    "designation": employee.designation.name if employee.designation_id else None,
                    "is_self": employee.user_id == request.user.pk,
                },
            }
        )
