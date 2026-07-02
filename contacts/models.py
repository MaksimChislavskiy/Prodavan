from django.db import models


class Company(models.Model):
    """Компания, с которой взаимодействует контакт."""
    pass


class Contact(models.Model):
    """Клиент или сотрудник, ФИО, телефон, почта, источник, этап?"""
    company = models.ForeignKey(Company, on_delete=models.CASCADE)
    pass


class MessengerAccount(models.Model):
    """Аккаунты: почта, Telegram, Max — привязаны к контакту."""
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE)
    pass


class ContactGroup(models.Model):
    """Списки контактов для чатов или рассылок."""
    pass
