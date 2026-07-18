from messaging.consumers import ReadOnlyEventConsumer
from messaging.realtime import user_group_name


class NotificationConsumer(ReadOnlyEventConsumer):
    def group_name_for_user(self, user):
        return user_group_name(user.id)

    async def notification_event(self, event):
        await self.send_event_payload(event)
