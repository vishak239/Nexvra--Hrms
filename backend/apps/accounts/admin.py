from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Permission, Role, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ["email"]
    list_display = ["email", "first_name", "last_name", "role", "is_active"]
    list_filter = ["role", "is_active"]
    search_fields = ["email", "first_name", "last_name"]
    fieldsets = [
        (None, {"fields": ["email", "password"]}),
        ("Profile", {"fields": ["first_name", "last_name", "role"]}),
        ("Status", {"fields": ["is_active", "is_staff", "is_superuser", "must_change_password"]}),
    ]
    add_fieldsets = [(None, {"fields": ["email", "first_name", "last_name", "role", "password1", "password2"]})]
    filter_horizontal = []


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "level", "is_system"]
    filter_horizontal = ["permissions"]


admin.site.register(Permission)
