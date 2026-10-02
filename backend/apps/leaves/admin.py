from django.contrib import admin

from .models import LeaveBalance, LeaveRequest, LeaveType

for model in (LeaveType, LeaveBalance, LeaveRequest,):
    admin.site.register(model)
