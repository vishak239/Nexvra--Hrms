from django.contrib import admin

from .models import EmployeeDocument

for model in (EmployeeDocument,):
    admin.site.register(model)
