from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from config.permissions import IsWorkspaceAdmin

from .onboarding import (
    get_onboarding_status,
    mark_materials_viewed,
    request_audit_context,
)
from .throttles import OnboardingWorkspaceThrottle


class OnboardingViewMixin:
    permission_classes = [IsAuthenticated, IsWorkspaceAdmin]
    throttle_classes = [OnboardingWorkspaceThrottle]

    def service_context(self, request):
        return {
            'workspace_id': request.user.workspace_id,
            'user_id': request.user.id,
            **request_audit_context(request),
        }


class OnboardingStatusView(OnboardingViewMixin, APIView):
    def get(self, request):
        return Response(get_onboarding_status(**self.service_context(request)))


class OnboardingMaterialsViewedView(OnboardingViewMixin, APIView):
    def post(self, request):
        return Response(mark_materials_viewed(**self.service_context(request)))
