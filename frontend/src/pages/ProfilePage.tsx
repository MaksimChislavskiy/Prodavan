import './ProfilePage.css'

export function ProfilePage() {
  return (
    <main className="profile-page">
      <section className="profile-page__card">
        <h1 className="profile-page__title">Профиль</h1>
        <p className="profile-page__text">
          Страница профиля будет подключена отдельным этапом.
        </p>
        <a className="profile-page__back" href="/app">
          Вернуться в CRM
        </a>
      </section>
    </main>
  )
}
