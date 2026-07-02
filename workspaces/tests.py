from django.test import TestCase

from .models import Workspace


class WorkspaceModelTests(TestCase):
    def test_string_representation_is_name(self):
        workspace = Workspace.objects.create(name='ООО Тест')

        self.assertEqual(str(workspace), 'ООО Тест')
