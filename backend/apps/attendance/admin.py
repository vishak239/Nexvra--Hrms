from django.contrib import admin

from .models import AttendanceRecord

for model in (AttendanceRecord,):
    admin.site.register(model)
