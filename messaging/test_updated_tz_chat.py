from django.test import SimpleTestCase

from .serializers import OutgoingMessageSerializer


class UpdatedTzChatTextContractTests(SimpleTestCase):
    def test_text_limit_is_applied_after_trim(self):
        serializer = OutgoingMessageSerializer(
            data={'text': f"  {'x' * 4096}  "},
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['text'], 'x' * 4096)

    def test_trimmed_text_longer_than_4096_is_rejected(self):
        serializer = OutgoingMessageSerializer(
            data={'text': f"  {'x' * 4097}  "},
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('text', serializer.errors)
