from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import RefreshToken


@receiver(post_save, sender=RefreshToken)
def sync_overdue_tasks_on_new_session(sender, instance, created, **kwargs):
    if not created:
        return

    user_id = instance.user_id

    def sync_summary():
        from notifications.task_deadlines import sync_overdue_task_summary_for_user
        from users.models import User

        user = User.objects.select_related('workspace').filter(id=user_id).first()
        if user is not None:
            sync_overdue_task_summary_for_user(user)

    transaction.on_commit(sync_summary, robust=True)
