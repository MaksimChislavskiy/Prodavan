from django.urls import path

from .contract_views import DealStageContractView, DealsContractView
from .views import (
    DealAIInsightsView,
    DealDetailView,
    DealHistoryView,
    KanbanView,
    StageDetailView,
    StagesView,
)


urlpatterns = [
    path('crm/kanban', KanbanView.as_view(), name='crm-kanban'),
    path('crm/deals', DealsContractView.as_view(), name='crm-deals'),
    path('crm/deals/<uuid:deal_id>', DealDetailView.as_view(), name='crm-deal-detail'),
    path(
        'crm/deals/<uuid:deal_id>/ai-insights',
        DealAIInsightsView.as_view(),
        name='crm-deal-ai-insights',
    ),
    path(
        'crm/deals/<uuid:deal_id>/stage',
        DealStageContractView.as_view(),
        name='crm-deal-stage',
    ),
    path(
        'crm/deals/<uuid:deal_id>/history',
        DealHistoryView.as_view(),
        name='crm-deal-history',
    ),
    path('crm/stages', StagesView.as_view(), name='crm-stages'),
    path(
        'crm/stages/<uuid:stage_id>',
        StageDetailView.as_view(),
        name='crm-stage-detail',
    ),
]
