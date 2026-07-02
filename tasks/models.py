from django.db import models


class Deal(models.Model):
    """(Сделка): Это про деньги, этапы воронки, сумму, вероятность закрытия.
    То, что на скриншоте: «Подписать договор — 350 000 ₽»"""
    contact = models.ForeignKey(Contact, on_delete=models.SET_NULL, null=True)
    company = models.ForeignKey(Company, on_delete=models.SET_NULL, null=True)  # важно!
    pass


class Task(models.Model):
    """сделка: название, контакт, сумма, ответственный, текущая колонка"""
    deal = models.ForeignKey(Deal, on_delete=models.CASCADE, null=True, blank=True)  # связь со сделкой
    contact = models.ForeignKey(Contact, on_delete=models.SET_NULL, null=True)
    pass


class Stage(models.Model):
    """колонка: название, порядок, воронка"""
    pass


class Pipeline(models.Model):
    """(воронка: название, проект) — если планируется несколько воронок"""
    pass