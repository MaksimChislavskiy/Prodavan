const canonicalObjectRoutes = [
  { pattern: /^\/chat\/([^/]+)\/?$/, appPath: '/app/chats', param: 'chat_id' },
  { pattern: /^\/deals\/([^/]+)\/?$/, appPath: '/app/deals', param: 'deal_id' },
  { pattern: /^\/contacts\/([^/]+)\/?$/, appPath: '/app/contacts', param: 'contact_id' },
  { pattern: /^\/tasks\/([^/]+)\/?$/, appPath: '/app/tasks', param: 'task_id' },
] as const

export function installNotificationDeepLinks() {
  normalizeNotificationDeepLink()
  window.addEventListener('popstate', normalizeNotificationDeepLink)
}

export function normalizeNotificationDeepLink() {
  const normalizedHref = getInternalNotificationHref(
    window.location.pathname,
    window.location.search,
    window.location.hash,
  )

  if (!normalizedHref) {
    return false
  }

  window.history.replaceState(window.history.state, '', normalizedHref)
  return true
}

export function getInternalNotificationHref(
  pathname: string,
  search = '',
  hash = '',
) {
  if (pathname === '/notifications' || pathname === '/notifications/') {
    return `/app/notifications${search}${hash}`
  }

  for (const route of canonicalObjectRoutes) {
    const match = pathname.match(route.pattern)
    if (!match) {
      continue
    }

    const entityId = decodeURIComponent(match[1]).trim()
    if (!entityId) {
      return null
    }

    const searchParams = new URLSearchParams(search)
    searchParams.set(route.param, entityId)
    const query = searchParams.toString()

    return `${route.appPath}${query ? `?${query}` : ''}${hash}`
  }

  return null
}
