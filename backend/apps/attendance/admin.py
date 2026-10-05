from django.contrib import admin

from .models import AttendanceRecord, Meeting, MeetingPause, NonWorkingPeriod, ResumeWorkRequest

for model in (AttendanceRecord, Meeting, MeetingPause, NonWorkingPeriod, ResumeWorkRequest):
    admin.site.register(model)
