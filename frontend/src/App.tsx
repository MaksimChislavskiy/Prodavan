import heroImage1 from './assets/landing/hero-1.png'
import heroImage2 from './assets/landing/hero-2.png'
import heroImage3 from './assets/landing/hero-3.png'
import heroImage4 from './assets/landing/hero-4.png'
import heroImage5 from './assets/landing/hero-5.png'
import heroImage6 from './assets/landing/hero-6.png'
import logoFull from './assets/brand/logo-full.svg'
import './App.css'

const imageCards = [
  {
    // title: 'Автоматизация процессов',
    image: heroImage1,
  },
  {
    // title: 'AI для продаж',
    image: heroImage4,
  },
  {
    // title: 'Сделки и аналитика',
    image: heroImage2,
  },
  {
    // title: 'Команда и стратегия',
    image: heroImage3,
  },
  {
    // title: 'Интеграции',
    image: heroImage5,
  },
  {
    // title: 'Социальные каналы',
    image: heroImage6,
  },
]

const imageColumns = [
  imageCards.slice(0, 3),
  imageCards.slice(3, 6),
]

function App() {
  return (
    <div className="appShell">
      <main className="landingPage">
        <header className="siteHeader">
          <a className="brand" href="/" aria-label="Продаван">
            <img className="brandLogoImage" src={logoFull} alt="Продаван" />
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
            {imageColumns.map((column, columnIndex) => (
              <div className="imageColumn" key={`column-${columnIndex}`}>
                {column.map((card, cardIndex) => {
                  const tileNumber = columnIndex * 3 + cardIndex + 1

                  return (
                    <div className={`imageTile tile${tileNumber}`} key={`tile-${tileNumber}`}>
                      <img src={card.image} alt="" />
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </section>

        <footer className="siteFooter">
          <div className="footerTop">
            <a className="footerBrand" href="/" aria-label="Продаван">
              <img className="brandLogoImage" src={logoFull} alt="Продаван" />
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
