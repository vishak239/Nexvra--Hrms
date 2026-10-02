from django.contrib import admin

from .models import Task, TaskResponse

for model in (Task, TaskResponse):
    admin.site.register(model)
