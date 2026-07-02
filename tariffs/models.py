from django.db import models


class TariffPlan(models.Model):
    """название, цена, ограничения:
    макс. проектов, макс. контактов, доступные отчёты"""
    pass


class UserTariff(models.Model):
    """связь пользователь → тариф, дата начала/конца"""
    pass
