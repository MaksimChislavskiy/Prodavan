from django.db import models


class Chat(models.Model):
    """название, проект, дата создания, тип: диалог/группа"""
    pass


class ChatParticipant(models.Model):
    """чат + контакт — связь"""
    pass


class Message(models.Model):
    """текст, отправитель, чат, время, тип мессенджера"""
    pass
