from django.contrib import admin

from .models import Notification

for model in (Notification,):
    admin.site.register(model)
