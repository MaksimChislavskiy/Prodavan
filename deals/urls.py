from django.urls import path

from .views import (
    DealDetailView,
    DealHistoryView,
    DealsView,
    DealStageView,
    KanbanView,
    StageDetailView,
    StagesView,
)


urlpatterns = [
    path('crm/kanban', KanbanView.as_view(), name='crm-kanban'),
    path('crm/deals', DealsView.as_view(), name='crm-deals'),
    path('crm/deals/<uuid:deal_id>', DealDetailView.as_view(), name='crm-deal-detail'),
    path(
        'crm/deals/<uuid:deal_id>/stage',
        DealStageView.as_view(),
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
