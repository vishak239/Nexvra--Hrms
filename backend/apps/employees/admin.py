from django.contrib import admin

from .models import Employee

for model in (Employee,):
    admin.site.register(model)
