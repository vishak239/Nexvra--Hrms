from rest_framework import serializers

from apps.accounts.usernames import USERNAME_MAX_LENGTH
from apps.employees.serializers import employee_ref
from apps.organization.models import CompanySettings

from . import rules
from .models import Task, TaskResponse


def _today(context):
    if "_today" not in context:
        context["_today"] = CompanySettings.get_solo().today()
    return context["_today"]


def user_ref(user):
    if user is None:
        return None
    return {"id": user.id, "full_name": user.full_name, "username": user.username}


class TaskResponseSerializer(serializers.ModelSerializer):
    author = serializers.SerializerMethodField()

    class Meta:
        model = TaskResponse
        fields = ["id", "author", "message", "created_at"]
        read_only_fields = fields

    def get_author(self, response):
        return user_ref(response.author)


class TaskSerializer(serializers.ModelSerializer):
    assigned_to = serializers.SerializerMethodField()
    assigned_by = serializers.SerializerMethodField()
    display_status = serializers.SerializerMethodField()
    is_overdue = serializers.SerializerMethodField()
    is_blocking = serializers.SerializerMethodField()
    is_assignee = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "title",
            "description",
            "priority",
            "due_date",
            "status",
            "display_status",
            "is_overdue",
            "requires_response",
            "assigned_to",
            "assigned_by",
            "acknowledged_at",
            "response",
            "responded_at",
            "completed_at",
            "cancelled_at",
            "cancel_reason",
            "created_at",
            "updated_at",
            "is_blocking",
            "is_assignee",
            "can_manage",
        ]
        read_only_fields = fields

    def _user(self):
        request = self.context.get("request")
        return request.user if request else None

    def get_assigned_to(self, task):
        return employee_ref(task.assigned_to)

    def get_assigned_by(self, task):
        return user_ref(task.assigned_by)

    def get_display_status(self, task):
        return task.display_status(_today(self.context))

    def get_is_overdue(self, task):
        return task.is_overdue(_today(self.context))

    def get_is_assignee(self, task):
        user = self._user()
        return bool(user and task.assigned_to.user_id == user.pk)

    def get_is_blocking(self, task):
        user = self._user()
        return bool(
            user
            and task.assigned_to.user_id == user.pk
            and not rules.is_exempt(user)
            and task.requires_response
            and task.status in rules.BLOCKING_STATUSES
            and task.responded_at is None
        )

    def get_can_manage(self, task):
        user = self._user()
        return bool(
            user
            and task.is_open
            and user.has_permission("tasks.manage")
            and (task.assigned_to.user_id != user.pk or user.is_super_admin)
        )


class TaskDetailSerializer(TaskSerializer):
    responses = TaskResponseSerializer(many=True, read_only=True)

    class Meta(TaskSerializer.Meta):
        fields = [*TaskSerializer.Meta.fields, "responses"]
        read_only_fields = fields


class TaskCreateSerializer(serializers.Serializer):
    """The assignee is identified by EITHER `employee_code` OR `username`; the server resolves
    it to the internal employee record."""

    employee_code = serializers.CharField(required=False, allow_blank=True, max_length=32)
    username = serializers.CharField(required=False, allow_blank=True, max_length=USERNAME_MAX_LENGTH + 1)
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, max_length=5000)
    priority = serializers.ChoiceField(choices=Task.Priority.choices, default=Task.Priority.MEDIUM)
    due_date = serializers.DateField(required=False, allow_null=True)
    requires_response = serializers.BooleanField(default=True)

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Title is required.")
        return value

    def validate_due_date(self, value):
        if value is not None and value < CompanySettings.get_solo().today():
            raise serializers.ValidationError("Due date cannot be in the past.")
        return value


class TaskUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200, required=False)
    description = serializers.CharField(required=False, allow_blank=True, max_length=5000)
    priority = serializers.ChoiceField(choices=Task.Priority.choices, required=False)
    due_date = serializers.DateField(required=False, allow_null=True)
    requires_response = serializers.BooleanField(required=False)

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Title is required.")
        return value


class TaskMessageSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=5000, trim_whitespace=True)


class TaskCompleteSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=5000, required=False, allow_blank=True)


class TaskCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True)
