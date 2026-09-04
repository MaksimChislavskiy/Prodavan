from django.test import SimpleTestCase

from .serializers import ContactCreateSerializer


class DealCardContactContractTests(SimpleTestCase):
    def test_telegram_is_normalized_to_single_leading_at(self):
        serializer = ContactCreateSerializer(data={
            'name': 'Иван Петров',
            'telegram': '@@ivan123',
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['telegram'], '@ivan123')

    def test_trailing_at_is_removed_before_telegram_validation(self):
        serializer = ContactCreateSerializer(data={
            'name': 'Иван Петров',
            'telegram': 'ivan123@',
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['telegram'], '@ivan123')
