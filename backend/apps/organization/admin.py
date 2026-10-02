from django.contrib import admin

from .models import Company, CompanySettings, Department, Designation, Holiday

for model in (Company, CompanySettings, Department, Designation, Holiday,):
    admin.site.register(model)
