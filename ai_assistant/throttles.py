from rest_framework.throttling import SimpleRateThrottle


class KnowledgeUploadWorkspaceThrottle(SimpleRateThrottle):
    scope = 'knowledge_file_upload'

    def allow_request(self, request, view):
        if request.method != 'POST':
            return True
        return super().allow_request(request, view)

    def get_cache_key(self, request, view):
        user = getattr(request, 'user', None)
        workspace_id = getattr(user, 'workspace_id', None)
        if not workspace_id:
            return None
        return self.cache_format % {
            'scope': self.scope,
            'ident': str(workspace_id),
        }
