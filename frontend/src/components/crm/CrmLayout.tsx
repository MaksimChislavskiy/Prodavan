import logoFull from '../../assets/brand/logo-full.svg'
import './CrmLayout.css'

type SidebarIconName =
  | 'ai'
  | 'dashboard'
  | 'deals'
  | 'contacts'
  | 'tasks'
  | 'settings'
  | 'chat'

type NavigationItem = {
  label: string
  icon: SidebarIconName
  href: string
  variant?: 'ai'
}

const navigationItems: NavigationItem[] = [
  { label: 'AI', icon: 'ai', href: '/app/ai', variant: 'ai' },
  { label: 'Рабочий стол', icon: 'dashboard', href: '/app' },
  { label: 'Сделки', icon: 'deals', href: '/app/deals' },
  { label: 'Контакты', icon: 'contacts', href: '/app/contacts' },
  { label: 'Задачи', icon: 'tasks', href: '/app/tasks' },
  { label: 'Настройки', icon: 'settings', href: '/app/settings/ai' },
  { label: 'Чат', icon: 'chat', href: '/app/chats' },
]

function SidebarIcon({ name }: { name: SidebarIconName }) {
  if (name === 'ai') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M15.7 3.5c-6.4 0-11.4 5.1-11.4 11.3 0 3.2 1.3 6.1 3.5 8.2v4.8c0 .6.5 1.1 1.1 1.1h7.4c.6 0 1.1-.5 1.1-1.1v-2.4h2.8c2.2 0 4-1.8 4-4v-2.2h1.9c.8 0 1.3-.9.9-1.6l-2.8-4.7C23.3 7.4 20 3.5 15.7 3.5Zm0 2.5c3.2 0 5.6 3.1 6.3 7.8l.1.3 2 3.3h-1.2c-.7 0-1.2.5-1.2 1.2v2.8c0 .8-.7 1.5-1.5 1.5h-4c-.7 0-1.2.5-1.2 1.2v2.3H10.3v-4c0-.4-.2-.7-.5-.9-1.9-1.6-3-4-3-6.6C6.8 10 10.8 6 15.7 6Z" />
        <path d="M16.1 6.7c.7 0 1.2.5 1.2 1.2v1.2a3.2 3.2 0 0 1 2 2h1.2a1.2 1.2 0 1 1 0 2.4h-1.2a3.2 3.2 0 0 1-2 2v2.2a3.2 3.2 0 1 1-2.4 0v-2.2a3.2 3.2 0 0 1-2-2h-1.2a1.2 1.2 0 0 1 0-2.4h1.2a3.2 3.2 0 0 1 2-2V7.9c0-.7.5-1.2 1.2-1.2Zm0 4.5a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Zm0 8.8a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z" />
      </svg>
    )
  }

  if (name === 'dashboard') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M5 14.6 16 5l11 9.6v12.2a1.2 1.2 0 0 1-1.2 1.2h-6.2a1.2 1.2 0 0 1-1.2-1.2v-6.5h-4.8v6.5a1.2 1.2 0 0 1-1.2 1.2H6.2A1.2 1.2 0 0 1 5 26.8V14.6Zm2.5 1.1v9.8h3.6V19c0-.7.5-1.2 1.2-1.2h7.4c.7 0 1.2.5 1.2 1.2v6.5h3.6v-9.8L16 8.3l-8.5 7.4Z" />
      </svg>
    )
  }

  if (name === 'deals') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M12.4 8.3 15 10l-4.6 4.6a3 3 0 0 0 4.2 4.2l1.5-1.5 5.6 5.6a2.8 2.8 0 0 0 4-4l-.4-.4.7-.7a2.8 2.8 0 0 0 0-4l-5.5-5.5a6 6 0 0 0-7.8-.5l-.3.5Zm-2.2 1.2-1.7-.9a1.2 1.2 0 0 0-1.6.5l-3.3 6.1a1.2 1.2 0 0 0 .5 1.7l4.2 2.2a1.2 1.2 0 0 0 1.6-.5l.8-1.5 1.4 1.4a5.5 5.5 0 0 0 7.8 7.8l.5.5a5.2 5.2 0 0 0 7.4-7.4l-.3-.3.2-.2a5.2 5.2 0 0 0 0-7.4l-5.5-5.5a8.5 8.5 0 0 0-12 .2Zm3.4.8a3.6 3.6 0 0 1 5.1 0l5.5 5.5a.4.4 0 0 1 0 .6l-1.6 1.6-6.5-6.5-3.3 3.3a.6.6 0 1 1-.9-.9l1.7-3.6ZM7.1 11.3l1.9 1-1.7 3.3-1.9-1 1.7-3.3Zm7.8 7.7 3.3 3.3a3 3 0 0 1-4.2-4.2l.9.9Z" />
      </svg>
    )
  }

  if (name === 'contacts') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M12.2 15.7a5.7 5.7 0 1 1 0-11.4 5.7 5.7 0 0 1 0 11.4Zm0-8.9a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Zm13 9.6a4.8 4.8 0 1 1 0-9.6 4.8 4.8 0 0 1 0 9.6Zm0-7.1a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6ZM2.8 28.4a1.2 1.2 0 0 1-1.2-1.2c0-5.4 4.7-9.8 10.6-9.8s10.6 4.4 10.6 9.8a1.2 1.2 0 1 1-2.5 0c0-4-3.6-7.3-8.1-7.3s-8.1 3.3-8.1 7.3a1.2 1.2 0 0 1-1.3 1.2Zm21.1-2.7a1.2 1.2 0 0 1-.4-2.4 6.6 6.6 0 0 1 1.7-.2c3 0 5.5 1.8 5.5 4.1a1.2 1.2 0 1 1-2.5 0c0-.8-1.2-1.6-3-1.6-.4 0-.7 0-1 .1h-.3Z" />
      </svg>
    )
  }

  if (name === 'tasks') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M8 5h18.5A1.5 1.5 0 0 1 28 6.5v19A1.5 1.5 0 0 1 26.5 27H15a1.2 1.2 0 1 1 0-2.5h10.5v-17H8v8a1.2 1.2 0 1 1-2.5 0v-9A1.5 1.5 0 0 1 7 5h1Zm8.7 10.1a1.2 1.2 0 0 1 0 1.8l-8.2 8.2a1.2 1.2 0 0 1-1.8 0l-3.4-3.4a1.3 1.3 0 0 1 1.8-1.8l2.5 2.5 7.3-7.3a1.2 1.2 0 0 1 1.8 0Z" />
      </svg>
    )
  }

  if (name === 'settings') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M18.1 2.8a1.2 1.2 0 0 1 1 .8l1 3a10.4 10.4 0 0 1 1.8 1l3.1-.7a1.2 1.2 0 0 1 1.2.5l2.1 3.7a1.2 1.2 0 0 1-.2 1.3l-2.1 2.3a10.7 10.7 0 0 1 0 2.1l2.1 2.3c.4.4.4 1 .2 1.4l-2.1 3.7a1.2 1.2 0 0 1-1.2.5l-3.1-.7c-.6.4-1.2.8-1.8 1.1l-1 3a1.2 1.2 0 0 1-1 .8h-4.2a1.2 1.2 0 0 1-1-.8l-1-3a10.4 10.4 0 0 1-1.8-1.1l-3.1.7a1.2 1.2 0 0 1-1.2-.5l-2.1-3.7a1.2 1.2 0 0 1 .2-1.4L6 16.8a10.7 10.7 0 0 1 0-2.1l-2.1-2.3a1.2 1.2 0 0 1-.2-1.3l2.1-3.7A1.2 1.2 0 0 1 7 6.9l3.1.7c.6-.4 1.2-.8 1.8-1l1-3a1.2 1.2 0 0 1 1-.8h4.2Zm-.9 2.5h-2.4l-.9 2.7c-.1.4-.4.7-.8.8-.8.3-1.5.7-2.1 1.2-.3.3-.8.4-1.2.3l-2.8-.6-1.2 2.1 1.9 2.1c.3.3.4.7.3 1.1a8 8 0 0 0 0 2.1c.1.4 0 .8-.3 1.1l-1.9 2.1 1.2 2.1 2.8-.6c.4-.1.9 0 1.2.3.6.5 1.3.9 2.1 1.2.4.1.7.4.8.8l.9 2.7h2.4l.9-2.7c.1-.4.4-.7.8-.8.8-.3 1.5-.7 2.1-1.2.3-.3.8-.4 1.2-.3l2.8.6 1.2-2.1-1.9-2.1c-.3-.3-.4-.7-.3-1.1a8 8 0 0 0 0-2.1c-.1-.4 0-.8.3-1.1l1.9-2.1-1.2-2.1-2.8.6c-.4.1-.9 0-1.2-.3a8 8 0 0 0-2.1-1.2c-.4-.1-.7-.4-.8-.8l-.9-2.7ZM16 11.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Zm0 2.5a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M11.5 5.2C6.3 5.2 2.2 8.9 2.2 13.4c0 2.2 1 4.1 2.6 5.6l-.9 4a1.2 1.2 0 0 0 1.7 1.3l4.6-2.1c.4.1.9.1 1.3.1 5.2 0 9.3-3.7 9.3-8.2s-4.1-8.9-9.3-8.9Zm0 2.5c3.8 0 6.8 2.6 6.8 5.7s-3 5.7-6.8 5.7c-.5 0-1 0-1.5-.2-.3-.1-.6 0-.9.1l-2.2 1 .4-1.8c.1-.5 0-.9-.4-1.2a5 5 0 0 1-2.2-3.7c0-3 3-5.6 6.8-5.6Zm9.1 2.5c5.2 0 9.2 3.7 9.2 8.2 0 2.2-1 4.1-2.6 5.6l.9 4a1.2 1.2 0 0 1-1.7 1.3l-4.6-2.1c-.4.1-.8.1-1.3.1-3.4 0-6.3-1.5-7.9-3.8 1-.1 1.9-.4 2.8-.8 1.2 1.3 3 2.1 5.1 2.1.5 0 1 0 1.5-.2.3-.1.6 0 .9.1l2.2 1-.4-1.8c-.1-.5 0-.9.4-1.2a5 5 0 0 0 2.2-3.7c0-3.1-3-5.7-6.8-5.7h-.4c-.1-.9-.4-1.7-.8-2.5.4-.1.8-.1 1.2-.1Z" />
    </svg>
  )
}

export function CrmLayout() {
  return (
    <div className="crm-shell">
      <aside className="crm-sidebar" aria-label="Основное меню CRM">
        <a className="crm-sidebar__logo" href="/app" aria-label="Продаван CRM">
          <img src={logoFull} alt="Продаван" />
        </a>

        <nav className="crm-sidebar__nav">
          {navigationItems.map((item) => (
            <a
              className={
                item.variant === 'ai'
                  ? 'crm-sidebar__link crm-sidebar__link--ai'
                  : 'crm-sidebar__link'
              }
              href={item.href}
              key={item.label}
            >
              <span className="crm-sidebar__icon">
                <SidebarIcon name={item.icon} />
              </span>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </aside>

      <div className="crm-main">
        <header className="crm-topbar">
          <form className="crm-ai-search" onSubmit={(event) => event.preventDefault()}>
            <span className="crm-ai-search__icon" aria-hidden="true">
              ✨
            </span>
            <input
              className="crm-ai-search__input"
              type="text"
              placeholder="Спросите AI"
              aria-label="Спросить AI"
              maxLength={200}
            />
            <button className="crm-ai-search__button" type="submit" aria-label="Отправить запрос AI">
              ↵
            </button>
          </form>

          <div className="crm-topbar__actions">
            <button className="crm-icon-button" type="button" aria-label="Уведомления">
              🔔
              <span className="crm-icon-button__badge">3</span>
            </button>

            <button className="crm-profile-button" type="button" aria-label="Меню профиля">
              <span className="crm-profile-button__avatar">М</span>
              <span className="crm-profile-button__name">Максим</span>
            </button>
          </div>
        </header>

        <main className="crm-content">
          <section className="crm-hero-card">
            <p className="crm-hero-card__eyebrow">CRM</p>
            <h1 className="crm-hero-card__title">Рабочий стол</h1>
            <p className="crm-hero-card__text">
              Это первая заглушка внутренней части CRM. Позже здесь появятся задачи на сегодня,
              онбординг и реальные данные из API.
            </p>
          </section>

          <section className="crm-widgets" aria-label="Заглушки виджетов рабочего стола">
            <article className="crm-widget">
              <span className="crm-widget__value">0</span>
              <span className="crm-widget__label">Задач на сегодня</span>
            </article>

            <article className="crm-widget">
              <span className="crm-widget__value">0</span>
              <span className="crm-widget__label">Просрочено</span>
            </article>

            <article className="crm-widget">
              <span className="crm-widget__value">—</span>
              <span className="crm-widget__label">AI пока без API</span>
            </article>
          </section>
        </main>
      </div>
    </div>
  )
}