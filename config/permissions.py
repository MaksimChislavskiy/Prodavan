from rest_framework.permissions import BasePermission


class IsWorkspaceAdmin(BasePermission):
    message = 'Недостаточно прав.'

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and getattr(user, 'workspace_id', None)
            and getattr(user, 'role', None) == 'admin'
        )
