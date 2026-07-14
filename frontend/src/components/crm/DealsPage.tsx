import { useEffect, useState, type FormEvent } from 'react'
import {
  createSalesStage,
  getKanban,
  type ApiKanbanDeal,
  type ApiKanbanResponse,
} from '../../shared/api/dealsApi'
import './DealsPage.css'

type DealsPageState = {
  data: ApiKanbanResponse | null
  isLoading: boolean
  error: string
}

const initialState: DealsPageState = {
  data: null,
  isLoading: true,
  error: '',
}

export function DealsPage() {
  const [state, setState] = useState<DealsPageState>(initialState)
  const [requestVersion, setRequestVersion] = useState(0)
  const [isStageEditorOpen, setIsStageEditorOpen] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [isStageSaving, setIsStageSaving] = useState(false)
  const [stageCreateError, setStageCreateError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadKanban() {
      setState((currentState) => ({
        ...currentState,
        isLoading: true,
        error: '',
      }))

      try {
        const data = await getKanban()

        if (!isMounted) {
          return
        }

        setState({
          data,
          isLoading: false,
          error: '',
        })
      } catch (error) {
        if (!isMounted) {
          return
        }

        setState({
          data: null,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Не удалось загрузить сделки',
        })
      }
    }

    void loadKanban()

    return () => {
      isMounted = false
    }
  }, [requestVersion])

  const openStageEditor = () => {
    setNewStageName('')
    setStageCreateError('')
    setIsStageEditorOpen(true)
  }

  const closeStageEditor = () => {
    if (isStageSaving) {
      return
    }

    setIsStageEditorOpen(false)
    setNewStageName('')
    setStageCreateError('')
  }

  const handleStageCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!state.data || isStageSaving) {
      return
    }

    const name = newStageName.trim()

    if (!name) {
      setStageCreateError('Введите название этапа.')
      return
    }

    if (name.length > 100) {
      setStageCreateError('Название этапа должно содержать не больше 100 символов.')
      return
    }

    const normalizedName = normalizeStageName(name)
    const isDuplicate = state.data.stages.some(
      (stage) => normalizeStageName(stage.name) === normalizedName,
    )

    if (isDuplicate) {
      setStageCreateError('Этап с таким названием уже существует.')
      return
    }

    setIsStageSaving(true)
    setStageCreateError('')

    try {
      const createdStage = await createSalesStage({
        name,
        order: state.data.stages.length + 1,
      })

      setState((currentState) => {
        if (!currentState.data) {
          return currentState
        }

        return {
          ...currentState,
          data: {
            stages: [
              ...currentState.data.stages,
              {
                ...createdStage,
                deal_count: 0,
              },
            ].sort((firstStage, secondStage) => firstStage.order - secondStage.order),
            deals: {
              ...currentState.data.deals,
              [createdStage.id]: [],
            },
          },
        }
      })

      setIsStageEditorOpen(false)
      setNewStageName('')
    } catch (error) {
      setStageCreateError(
        error instanceof Error ? error.message : 'Не удалось создать этап.',
      )
    } finally {
      setIsStageSaving(false)
    }
  }

  if (state.isLoading) {
    return <DealsSkeleton />
  }

  if (state.error || !state.data) {
    return (
      <section className="deals-state-card" aria-live="polite">
        <h1 className="deals-state-card__title">Не удалось загрузить сделки</h1>
        <p className="deals-state-card__text">{state.error}</p>
        <button
          className="deals-state-card__button"
          type="button"
          onClick={() => setRequestVersion((currentVersion) => currentVersion + 1)}
        >
          Повторить
        </button>
      </section>
    )
  }

  return (
    <section className="deals-page" aria-label="Сделки">
      <div className="deals-board" aria-label="Воронка сделок">
        {state.data.stages.map((stage) => {
          const stageDeals = state.data?.deals[stage.id] ?? []

          return (
            <article className="deals-column" key={stage.id}>
              <header className="deals-stage">
                <div className="deals-stage__meta">
                  <span className="deals-stage__title" title={stage.name}>
                    {stage.name}
                  </span>
                  <span className="deals-stage__count">{stage.deal_count}</span>
                </div>

                {stage.is_system ? (
                  <button
                    className="deals-stage__action deals-stage__action--add"
                    type="button"
                    aria-label="Добавить сделку"
                    title="Создание сделки добавим следующим этапом"
                    disabled
                  >
                    +
                  </button>
                ) : (
                  <button
                    className="deals-stage__action"
                    type="button"
                    aria-label={`Меню этапа ${stage.name}`}
                    title="Управление этапом добавим позже"
                    disabled
                  >
                    ⋮
                  </button>
                )}
              </header>

              <div className="deals-column__cards">
                {stageDeals.map((deal) => (
                  <DealCard deal={deal} key={deal.id} />
                ))}
              </div>
            </article>
          )
        })}

        <article className="deals-column deals-column--add-stage">
          {isStageEditorOpen ? (
            <form className="deals-stage-create" onSubmit={(event) => void handleStageCreate(event)}>
              <div className="deals-stage-create__row">
                <input
                  className="deals-stage-create__input"
                  type="text"
                  value={newStageName}
                  maxLength={100}
                  autoFocus
                  placeholder="Название этапа"
                  aria-label="Название нового этапа"
                  disabled={isStageSaving}
                  onChange={(event) => {
                    setNewStageName(event.target.value)
                    setStageCreateError('')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      closeStageEditor()
                    }
                  }}
                />

                <button
                  className="deals-stage-create__button deals-stage-create__button--save"
                  type="submit"
                  aria-label="Сохранить этап"
                  disabled={isStageSaving || !newStageName.trim()}
                >
                  {isStageSaving ? '…' : '✓'}
                </button>

                <button
                  className="deals-stage-create__button"
                  type="button"
                  aria-label="Отменить создание этапа"
                  disabled={isStageSaving}
                  onClick={closeStageEditor}
                >
                  ×
                </button>
              </div>

              {stageCreateError && (
                <p className="deals-stage-create__error" role="alert">
                  {stageCreateError}
                </p>
              )}
            </form>
          ) : (
            <button
              className="deals-add-stage"
              type="button"
              aria-label="Добавить этап"
              onClick={openStageEditor}
            >
              +
            </button>
          )}
        </article>
      </div>
    </section>
  )
}

function DealCard({ deal }: { deal: ApiKanbanDeal }) {
  return (
    <article className="deals-card">
      <div className="deals-card__header">
        <h2 className="deals-card__title" title={deal.name}>
          {deal.name}
        </h2>
        <button
          className="deals-card__menu"
          type="button"
          aria-label={`Меню сделки ${deal.name}`}
          title="Действия со сделкой добавим позже"
          disabled
        >
          ⋮
        </button>
      </div>

      <div className="deals-card__line" />

      <div className="deals-card__body">
        <span className="deals-card__customer" title={getContactName(deal)}>
          {getContactName(deal)}
        </span>
        <span className="deals-card__amount">{formatDealAmount(deal)}</span>
        <span className="deals-card__date">{formatDealDate(deal.created_at)}</span>
      </div>
    </article>
  )
}

function DealsSkeleton() {
  return (
    <section className="deals-page" aria-label="Загружаем сделки" aria-busy="true">
      <div className="deals-board deals-board--skeleton">
        {Array.from({ length: 4 }, (_, index) => (
          <article className="deals-column" key={index}>
            <div className="deals-skeleton deals-skeleton--stage" />
            <div className="deals-skeleton deals-skeleton--card" />
          </article>
        ))}
      </div>
    </section>
  )
}

function normalizeStageName(name: string) {
  return name.trim().toLocaleLowerCase('ru-RU')
}

function getContactName(deal: ApiKanbanDeal) {
  return deal.contact?.name || 'Контакт не указан'
}

function formatDealAmount(deal: ApiKanbanDeal) {
  if (deal.amount === null) {
    return 'Не указана'
  }

  const amount = Number(deal.amount)

  if (!Number.isFinite(amount)) {
    return `${deal.amount} ${deal.currency}`
  }

  const formattedAmount = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(amount)

  return deal.currency === 'RUB'
    ? `${formattedAmount} ₽`
    : `${formattedAmount} ${deal.currency}`
}

function formatDealDate(date: string) {
  const parsedDate = new Date(date)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Дата не указана'
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsedDate)
}
