from django.test import TestCase, override_settings

from users.models import User

from .automation import AutomationAnalysisClient
from .chat_services import _build_model_messages
from .models import AIChatSession, AISettings


class RecordingChatClient:
    def __init__(self):
        self.messages = None

    def complete(self, messages):
        self.messages = messages

        class Result:
            content = '{}'

        return Result()


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    AI_CHAT_MAX_CONTEXT_TOKENS=20_000,
)
class NewTzInstructionScopeTests(TestCase):
    marker = 'TZ_AUTOPILOT_ONLY_MARKER_9F74'

    def setUp(self):
        self.user = User.objects.create_user(
            email='instruction-scope@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        AISettings.objects.create(
            workspace=self.user.workspace,
            instruction=self.marker,
        )

    def test_workspace_instruction_is_not_added_to_ai_chat_prompt(self):
        session = AIChatSession.objects.create(
            workspace=self.user.workspace,
            user=self.user,
        )

        messages = _build_model_messages(
            session=session,
            sources=[],
            crm_context='{}',
        )

        self.assertNotIn(self.marker, messages[0]['content'])

    def test_workspace_instruction_is_not_added_to_crm_analysis_prompt(self):
        recorder = RecordingChatClient()
        client = AutomationAnalysisClient(chat_client=recorder)

        class Workspace:
            id = self.user.workspace_id
            timezone = 'UTC'

        class Contact:
            id = self.user.id
            name = 'Клиент'
            company = ''
            phone = ''
            email = ''
            telegram = ''
            comment = ''

        class Chat:
            contact = Contact()

        class Message:
            id = self.user.id
            text = 'Хочу купить продукт'

        class Event:
            workspace_id = self.user.workspace_id
            workspace = Workspace()
            chat = Chat()
            message_id = self.user.id
            message = Message()

        client.analyze(event=Event(), context_messages=[])

        self.assertIsNotNone(recorder.messages)
        self.assertNotIn(self.marker, recorder.messages[0]['content'])
