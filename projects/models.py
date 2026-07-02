from django.db import models


class ProjectMember(models.Model):
    """
    (кто из контактов-сотрудников имеет доступ к проекту) —
    если у вас один проект и пользователь — владелец,
    но есть другие сотрудники.
    """
    pass
