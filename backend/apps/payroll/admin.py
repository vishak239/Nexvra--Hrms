from django.contrib import admin

from .models import PayComponent, PayrollRun, Payslip, SalaryStructure

for model in (PayComponent, SalaryStructure, PayrollRun, Payslip,):
    admin.site.register(model)
