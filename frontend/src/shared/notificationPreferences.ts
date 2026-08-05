export type NotificationPreferences = {
  browserEnabled: boolean
}

export const NOTIFICATION_PREFERENCES_STORAGE_KEY =
  'prodavan.notification-settings.figma.v1'

const DEFAULT_PREFERENCES: NotificationPreferences = {
  browserEnabled: false,
}

export function readNotificationPreferences(): NotificationPreferences {
  try {
    const storedValue = window.localStorage.getItem(
      NOTIFICATION_PREFERENCES_STORAGE_KEY,
    )

    if (!storedValue) {
      return DEFAULT_PREFERENCES
    }

    const parsed = JSON.parse(storedValue) as { browserEnabled?: unknown }

    return {
      browserEnabled: parsed.browserEnabled === true,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function writeNotificationPreferences(
  preferences: NotificationPreferences,
) {
  try {
    window.localStorage.setItem(
      NOTIFICATION_PREFERENCES_STORAGE_KEY,
      JSON.stringify(preferences),
    )
  } catch {
    return
  }
}
