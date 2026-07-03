import './App.css'

const imageCards = [
  'Автоматизация процессов',
  'AI для продаж',
  'Сделки и аналитика',
  'Команда и стратегия',
  'Социальные каналы',
]

function App() {
  return (
    <div className="appShell">
      <main className="landingPage">
        <header className="siteHeader">
          <a className="brand" href="/">
            <span className="brandIcon">↗</span>
            <span className="brandText">ПРОДАВАН</span>
          </a>

          <nav className="mainNav" aria-label="Основная навигация">
            <a href="#how-it-works">Как это работает</a>
            <a href="#pricing">Тарифы</a>
          </nav>

          <div className="headerActions">
            <button className="loginButton" type="button">
              Войти
            </button>

            <button className="registerButton" type="button">
              Зарегистрироваться
            </button>
          </div>
        </header>

        <section className="heroSection">
          <div className="heroContent">
            <h1>
              Сложные процессы — простыми словами CRM с AI, которая понимает вас
            </h1>

            <p>
              Внедрение за один день, поддержка AI на каждом этапе и интерфейс,
              в котором не нужно учиться работать
            </p>

            <button className="trialButton" type="button">
              Бесплатно 14 дней
            </button>
          </div>

          <div className="imageCollage" aria-label="Иллюстрации возможностей CRM">
            {imageCards.map((title, index) => (
              <div className={`imageTile tile${index + 1}`} key={title}>
                <span>{title}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="siteFooter">
          <div className="footerTop">
            <a className="footerBrand" href="/">
              <span className="brandIcon">↗</span>
              <span className="brandText">ПРОДАВАН</span>
            </a>

            <nav className="footerNav" aria-label="Навигация в подвале">
              <a href="#how-it-works">Как это работает</a>
              <a href="#pricing">Тарифы</a>
            </nav>

            <div className="footerContacts">
              <h2>Контакты</h2>
              <a href="#telegram">Telegram</a>
              <a href="#instagram">Instagram</a>
              <a href="#vk">VKontakte</a>
            </div>
          </div>

          <div className="footerBottom">
            <span>Атмосфера</span>
            <span>© 2026 Продаван. Все права защищены.</span>
            <a href="#privacy">Политика конфиденциальности</a>
            <a href="#terms">Условиями</a>
          </div>
        </footer>
      </main>
    </div>
  )
}

export default App
