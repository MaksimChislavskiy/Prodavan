import './DealsPage.css'

type DealStage = {
  id: string
  title: string
  count: number
}

type DealCard = {
  id: string
  stageId: string
  title: string
  customer: string
  amount: string
  date: string
}

const stages: DealStage[] = [
  { id: 'new', title: 'Новый лид', count: 1 },
  { id: 'processed', title: 'Обработан', count: 1 },
  { id: 'contract', title: 'Оформление', count: 1 },
  { id: 'payment', title: 'Оплата', count: 1 },
  { id: 'completed', title: 'Завершено', count: 0 },
  { id: 'add', title: '+', count: 0 },
]

const deals: DealCard[] = [
  {
    id: 'deal-1',
    stageId: 'new',
    title: 'Сделка',
    customer: 'Петр',
    amount: '560 000 ₽',
    date: '03.03.2026',
  },
  {
    id: 'deal-2',
    stageId: 'processed',
    title: 'Сделка',
    customer: 'Василиса',
    amount: '5 000 000 ₽',
    date: '07.03.2026',
  },
  {
    id: 'deal-3',
    stageId: 'contract',
    title: 'Сделка',
    customer: 'Компания Energy star',
    amount: '1 000 000 ₽',
    date: '03.03.2026',
  },
  {
    id: 'deal-4',
    stageId: 'payment',
    title: 'Сделка',
    customer: 'Сергей',
    amount: '700 000 ₽',
    date: '03.03.2026',
  },
]

export function DealsPage() {
  return (
    <section className="deals-page" aria-label="Сделки">
      <div className="deals-board">
        <div className="deals-board__stages" aria-label="Этапы воронки">
          {stages.map((stage) => (
            <article className="deals-stage" key={stage.id}>
              <div className="deals-stage__meta">
                <span className="deals-stage__title">{stage.title}</span>
                {stage.id !== 'add' && <span className="deals-stage__count">{stage.count}</span>}
              </div>

              {stage.id === 'new' && (
                <button className="deals-stage__add" type="button" aria-label="Добавить сделку">
                  +
                </button>
              )}
            </article>
          ))}
        </div>

        <div className="deals-board__cards" aria-label="Карточки сделок">
          {deals.map((deal) => (
            <article className={`deals-card deals-card--${deal.stageId}`} key={deal.id}>
              <div className="deals-card__header">
                <h2 className="deals-card__title">{deal.title}</h2>
                <button className="deals-card__menu" type="button" aria-label="Меню сделки">
                  ⋮
                </button>
              </div>

              <div className="deals-card__line" />

              <div className="deals-card__body">
                <span className="deals-card__customer">{deal.customer}</span>
                <span className="deals-card__amount">{deal.amount}</span>
                <span className="deals-card__date">{deal.date}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
