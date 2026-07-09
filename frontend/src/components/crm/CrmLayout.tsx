import './CrmLayout.css';

const navigationItems = [
  { label: 'Рабочий стол', active: true },
  { label: 'Сделки', active: false },
  { label: 'Контакты', active: false },
  { label: 'Задачи', active: false },
  { label: 'Чаты', active: false },
  { label: 'Настройки AI', active: false },
];

export function CrmLayout() {
  return (
    <div className="crm-shell">
      <aside className="crm-sidebar" aria-label="Основное меню CRM">
        <a className="crm-sidebar__logo" href="/app" aria-label="Продаван CRM">
          <span className="crm-sidebar__logo-mark">П</span>
          <span className="crm-sidebar__logo-text">Продаван</span>
        </a>

        <nav className="crm-sidebar__nav">
          {navigationItems.map((item) => (
            <button
              className={item.active ? 'crm-sidebar__link crm-sidebar__link--active' : 'crm-sidebar__link'}
              type="button"
              key={item.label}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="crm-sidebar__footer">
          <span className="crm-sidebar__footer-title">Mock-режим</span>
          <span className="crm-sidebar__footer-text">CRM без API</span>
        </div>
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
  );
}