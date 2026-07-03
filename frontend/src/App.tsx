import { useEffect, useState } from 'react'
import RegisterModal from './RegisterModal'
import heroImage1 from './assets/landing/hero-1.png'
import heroImage2 from './assets/landing/hero-2.png'
import heroImage3 from './assets/landing/hero-3.png'
import heroImage4 from './assets/landing/hero-4.png'
import heroImage5 from './assets/landing/hero-5.png'
import heroImage6 from './assets/landing/hero-6.png'
import stepLearningImage from './assets/how-it-works/step-learning.png'
import stepSalesImage from './assets/how-it-works/step-sales.png'
import stepControlImage from './assets/how-it-works/step-control.png'
import videoPreviewImage from './assets/how-it-works/video-preview.png'
import ctaImage from './assets/how-it-works/cta-image.png'
import logoFull from './assets/brand/logo-full.svg'
import './App.css'

type Page = 'home' | 'how' | 'pricing'

const imageCards = [
  {
    image: heroImage1,
  },
  {
    image: heroImage4,
  },
  {
    image: heroImage2,
  },
  {
    image: heroImage3,
  },
  {
    image: heroImage5,
  },
  {
    image: heroImage6,
  },
]

const imageColumns = [
  imageCards.slice(0, 3),
  imageCards.slice(3, 6),
]

const workCards = [
  {
    title: 'Обучение',
    text: 'Загрузите данные и дайте ИИ мозги вашей компании',
    image: stepLearningImage,
  },
  {
    title: 'Продажи',
    text: 'Бот общается, квалифицирует и дожимает 24/7',
    image: stepSalesImage,
  },
  {
    title: 'Контроль',
    text: 'Получайте готовые отчеты и подключайтесь только для важных сделок',
    image: stepControlImage,
  },
]

const testimonials = [
  {
    text: '«Бот ловит клиентов ночью, а я сплю. Утром уже готовые сделки.»',
    name: 'Елена Орлова',
    role: 'Владелица салона мебели',
    source: 'VKontakte',
  },
  {
    text: '«За месяц выручка выросла на 40%. Менеджер один, а работает как трое.»',
    name: 'Мария Сидорова',
    role: 'Директор интернет магазина',
    source: 'VKontakte',
  },
]

const pricingPlans = [
  {
    name: 'БАЗОВЫЙ',
    price: 'Бесплатно',
    billing: '',
    features: [
      'До 10 сделок в месяц',
      'Лиды до 10 записей',
      'Чаты в одном окне',
    ],
  },
  {
    name: 'ПРОДАВАН.AI',
    price: '1490 ₽',
    billing: 'Выгодно: 17.000 ₽ / год',
    features: [
      'Неограниченные сделки',
      'Лиды до 500 записей',
      'AI-ассистент 24/7',
      'Интеграции включены',
      'Облачное хранилище для файлов до 5 ГБ',
      'Чаты в одном окне',
    ],
  },
  {
    name: 'ПРОДАВАН.БИЗНЕС',
    price: '3999 ₽',
    billing: 'Выгодно: 40.000 ₽ / год',
    features: [
      'Неограниченные сделки',
      'Неограниченные лиды',
      'AI-ассистент 24/7',
      'Интеграции включены',
      'Облачное хранилище для файлов до 15 ГБ',
      'Чаты в одном окне',
    ],
  },
]

const pricingComparisonSections = [
  {
    title: 'Основной функционал',
    rows: [
      ['Сделки в месяц', '10', 'Без лимита', 'Без лимита'],
      ['Управление контактами', '✓', '✓', '✓'],
      ['Единое окно чатов', '✓', '✓', '✓'],
      ['Лиды', '50', '500', 'Без лимита'],
      ['Облачное хранилище для файлов', '', 'до 5 ГБ', 'до 15 ГБ'],
      ['Экспорт данных', '', '', '✓'],
    ],
  },
  {
    title: 'Искусственный интеллект',
    rows: [
      ['AI-ассистент в чатах', 'Нет', 'Да', 'Да'],
      ['Обучение бота на ваших данных', '', '✓', '✓'],
      ['Автоматическая обработка запросов', '', '✓', '✓'],
      ['Запись встречи и задач', '', '', '✓'],
    ],
  },
  {
    title: 'Интеграции и платежи',
    rows: [
      ['Доступные интеграции', '3', 'Все', 'Все'],
      ['Платежные шлюзы', '✓', '✓', '✓'],
      ['Рассылки и сегменты', '✓', '✓', '✓'],
      ['Мессенджеры и соцсети', '✓', '✓', '✓'],
      ['Бухгалтерские системы', '', '✓', '✓'],
    ],
  },
]

const pricingQuestions = [
  {
    question: 'Как изменить тариф?',
    answer:
      'Можно в любой момент. Повышение начинает работать сразу, понижение — со следующего периода.',
  },
  {
    question: 'Что если тариф не подойдет?',
    answer:
      'У вас есть 14 дней на тестовый доступ ко всем функциям. Если не понравится, платить ничего не нужно.',
  },
  {
    question: 'Можно ли отменить подписку?',
    answer:
      'Да. Отмена доступна в любой день. Доступ сохранится до конца оплаченного периода.',
  },
  {
    question: 'Включены ли интеграции в цену?',
    answer:
      'В ПРОДАВАН.AI и ПРОДАВАН.БИЗНЕС основные интеграции включены. В бесплатном тарифе — только базовые.',
  },
]

function App() {
  const getPageFromPath = (): Page => {
    if (window.location.pathname === '/how-it-works') {
      return 'how'
    }

    if (window.location.pathname === '/pricing') {
      return 'pricing'
    }

    return 'home'
  }

  const [currentPage, setCurrentPage] = useState<Page>(getPageFromPath)
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false)

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPage(getPageFromPath())
      window.scrollTo(0, 0)
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  const openHomePage = () => {
    window.history.pushState(null, '', '/')
    setCurrentPage('home')
    window.scrollTo(0, 0)
  }

  const openHowPage = () => {
    window.history.pushState(null, '', '/how-it-works')
    setCurrentPage('how')
    window.scrollTo(0, 0)
  }

  const openPricingPage = () => {
    window.history.pushState(null, '', '/pricing')
    setCurrentPage('pricing')
    window.scrollTo(0, 0)
  }

  const openRegisterModal = () => {
    setIsRegisterModalOpen(true)
  }

  return (
    <div className="appShell">
      <main className="landingPage">
        <header className="siteHeader">
          <a
            className="brand"
            href="/"
            aria-label="Продаван"
            onClick={(event) => {
              event.preventDefault()
              openHomePage()
            }}
          >
            <img className="brandLogoImage" src={logoFull} alt="Продаван" />
          </a>

          <nav className="mainNav" aria-label="Основная навигация">
            <a
              href="/how-it-works"
              onClick={(event) => {
                event.preventDefault()
                openHowPage()
              }}
            >
              Как это работает
            </a>

            <a
              href="/pricing"
              onClick={(event) => {
                event.preventDefault()
                openPricingPage()
              }}
            >
              Тарифы
            </a>
          </nav>

          <div className="headerActions">
            <button className="loginButton" type="button">
              Войти
            </button>

            <button className="registerButton" type="button" onClick={openRegisterModal}>
              Зарегистрироваться
            </button>
          </div>
        </header>

        {currentPage === 'home' && <HomePage onOpenRegister={openRegisterModal} />}
        {currentPage === 'how' && <HowItWorksPage onOpenRegister={openRegisterModal} />}
        {currentPage === 'pricing' && <PricingPage onOpenRegister={openRegisterModal} />}

        <footer className="siteFooter">
          <div className="footerTop">
            <a
              className="footerBrand"
              href="/"
              aria-label="Продаван"
              onClick={(event) => {
                event.preventDefault()
                openHomePage()
              }}
            >
              <img className="brandLogoImage" src={logoFull} alt="Продаван" />
            </a>

            <nav className="footerNav" aria-label="Навигация в подвале">
              <a
                href="/how-it-works"
                onClick={(event) => {
                  event.preventDefault()
                  openHowPage()
                }}
              >
                Как это работает
              </a>

              <a
                href="/pricing"
                onClick={(event) => {
                  event.preventDefault()
                  openPricingPage()
                }}
              >
                Тарифы
              </a>
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

      {isRegisterModalOpen && (
        <RegisterModal
          onClose={() => setIsRegisterModalOpen(false)}
          onOpenLogin={() => setIsRegisterModalOpen(false)}
        />
      )}
    </div>
  )
}

type RegisterTriggerProps = {
  onOpenRegister: () => void
}

function HomePage({ onOpenRegister }: RegisterTriggerProps) {
  return (
    <section className="heroSection">
      <div className="heroContent">
        <h1>
          Сложные процессы — простыми словами CRM с AI, которая понимает вас
        </h1>

        <p>
          Внедрение за один день, поддержка AI на каждом этапе и интерфейс,
          в котором не нужно учиться работать
        </p>

        <button className="trialButton" type="button" onClick={onOpenRegister}>
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
  )
}

function HowItWorksPage({ onOpenRegister }: RegisterTriggerProps) {
  return (
    <>
      <section className="howSection" id="how-it-works">
        <div className="howIntro">
          <h2>Как это работает</h2>
          <p>
            Ваш отдел продаж на автопилоте: пока вы отдыхаете, ИИ закрывает сделки
          </p>
        </div>

        <div className="workFlow">
          <h3>
            Путь от первой заявки до закрытого чека: ИИ делает работу, вы получаете результат
          </h3>

          <div className="workCards">
            {workCards.map((card) => (
              <article className="workCard" key={card.title}>
                <img className="workCardImage" src={card.image} alt="" />

                <div className="workCardContent">
                  <h4>{card.title}</h4>
                  <p>{card.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="videoBlock">
          <img className="videoPreview" src={videoPreviewImage} alt="" />

          <p>
            Посмотрите, как Продаван экономит 4 часа вашего времени каждый день
          </p>
        </div>
      </section>

      <section className="testimonialsSection">
        <div className="testimonialsIntro">
          <h2>Что говорят люди</h2>
          <p>Те, кто уже начал продавать по-новому</p>
        </div>

        <div className="testimonialCards">
          {testimonials.map((testimonial) => (
            <article className="testimonialCard" key={testimonial.name}>
              <div className="stars" aria-label="5 из 5">
                ★★★★★
              </div>

              <p className="testimonialText">{testimonial.text}</p>

              <div className="testimonialAuthor">
                <div className="authorAvatar" aria-hidden="true" />

                <div>
                  <h3>{testimonial.name}</h3>
                  <p>{testimonial.role}</p>
                </div>

                <span>{testimonial.source}</span>
              </div>
            </article>
          ))}
        </div>

        <div className="sliderControls" aria-label="Навигация по отзывам">
          <span className="sliderDots">● ○ ○ ○</span>

          <div className="sliderButtons">
            <button type="button" aria-label="Предыдущий отзыв">
              ←
            </button>
            <button type="button" aria-label="Следующий отзыв">
              →
            </button>
          </div>
        </div>
      </section>

      <section className="ctaSection">
        <div className="ctaContent">
          <h2>Начните продавать сейчас</h2>

          <p>
            Попробуйте бесплатно прямо сейчас — автоматизируйте продажи за 5 минут!
          </p>

          <button className="trialButton" type="button" onClick={onOpenRegister}>
            Бесплатно 14 дней
          </button>
        </div>

        <img className="ctaImage" src={ctaImage} alt="" />
      </section>
    </>
  )
}

function PricingPage({ onOpenRegister }: RegisterTriggerProps) {
  return (
    <main className="pricingSection">
      <section className="pricingIntro">
        <h2>Тарифы</h2>
        <p>Гибкие решения для любого проекта</p>
      </section>

      <section className="pricingCards">
        {pricingPlans.map((plan) => (
          <article className="pricingCard" key={plan.name}>
            <div className="pricingCardContent">
              <h3>{plan.name}</h3>
              <p className="pricingPrice">{plan.price}</p>
              {plan.billing && <p className="pricingBilling">{plan.billing}</p>}

              <div className="pricingDivider" />

              <p className="pricingIncludedTitle">Включено:</p>

              <ul className="pricingFeatures">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>

            <button className="pricingBuyButton" type="button" onClick={onOpenRegister}>
              Купить
            </button>
          </article>
        ))}
      </section>

      <section className="pricingCompareSection">
        <div className="pricingCompareIntro">
          <h2>Что входит</h2>
          <p>Сравните все возможности и выберите свой путь</p>
        </div>

        <div className="pricingCompareTable">
          <div className="pricingCompareHeader">
            <span />
            <span>БАЗОВЫЙ</span>
            <span>ПРОДАВАН.AI</span>
            <span>ПРОДАВАН.БИЗНЕС</span>
          </div>

          {pricingComparisonSections.map((section) => (
            <div className="pricingCompareGroup" key={section.title}>
              <h3>{section.title}</h3>

              {section.rows.map(([label, base, ai, business]) => (
                <div className="pricingCompareRow" key={label}>
                  <span>{label}</span>
                  <span>{base}</span>
                  <span>{ai}</span>
                  <span>{business}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="pricingQuestionsSection">
        <div className="pricingQuestionsIntro">
          <h2>Вопросы</h2>
          <p>Ответы на то, что волнует всех</p>
        </div>

        <div className="pricingQuestionCards">
          {pricingQuestions.map((item) => (
            <article className="pricingQuestionCard" key={item.question}>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
