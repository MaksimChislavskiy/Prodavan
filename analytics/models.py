from django.db import models


class Report(models.Model):
    """название, тип, параметры фильтрации JSON, владелец-пользователь"""
    pass


class ReportResult(models.Model):
    """кэш результата или ссылка на экспортированный файл"""
    filter_params = JSONField()
    pass
