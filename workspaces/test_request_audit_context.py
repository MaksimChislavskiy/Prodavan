from django.test import RequestFactory, SimpleTestCase

from .onboarding import request_audit_context


class RequestAuditContextTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_x_real_ip_is_used_instead_of_proxy_remote_addr(self):
        request = self.factory.get(
            '/',
            HTTP_X_REAL_IP='203.0.113.15',
            HTTP_USER_AGENT='ProdavanProxyAudit/1.0',
            REMOTE_ADDR='172.18.0.4',
        )

        context = request_audit_context(request)

        self.assertEqual(context['ip_address'], '203.0.113.15')
        self.assertEqual(context['user_agent'], 'ProdavanProxyAudit/1.0')

    def test_remote_addr_is_fallback_without_reverse_proxy_header(self):
        request = self.factory.get('/', REMOTE_ADDR='198.51.100.22')

        context = request_audit_context(request)

        self.assertEqual(context['ip_address'], '198.51.100.22')
