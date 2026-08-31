import { useCallback, useEffect, useState } from 'react'
import type { ApiContact } from '../../shared/api/contactsApi'
import { ContactFormModal } from './ContactFormModal'
import { ContactViewModal } from './ContactViewModal'
import { ViewDealModal } from './ViewDealModal'

type DeepLinkTarget =
  | { kind: 'contact'; id: string; name: string }
  | { kind: 'deal'; id: string; name: string }
  | null

type EditingContact = Pick<ApiContact, 'id' | 'name'> | null

export function CrmObjectDeepLinkController() {
  const [target, setTarget] = useState<DeepLinkTarget>(readDeepLinkTarget)
  const [editingContact, setEditingContact] = useState<EditingContact>(null)

  useEffect(() => {
    const handleLocationChange = () => {
      setEditingContact(null)
      setTarget(readDeepLinkTarget())
    }

    window.addEventListener('popstate', handleLocationChange)
    return () => window.removeEventListener('popstate', handleLocationChange)
  }, [])

  const closeTarget = useCallback(() => {
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.delete('contact_id')
    searchParams.delete('contact_name')
    searchParams.delete('deal_id')
    searchParams.delete('deal_name')

    const query = searchParams.toString()
    const href = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', href)
    setEditingContact(null)
    setTarget(null)
  }, [])

  if (!target) {
    return null
  }

  if (target.kind === 'contact') {
    if (editingContact) {
      return (
        <ContactFormModal
          mode="edit"
          contactId={editingContact.id}
          contactName={editingContact.name}
          onClose={() => setEditingContact(null)}
          onCreated={() => setEditingContact(null)}
          onUpdated={() => setEditingContact(null)}
          onNotFound={closeTarget}
        />
      )
    }

    return (
      <ContactViewModal
        contactId={target.id}
        contactName={target.name}
        onClose={closeTarget}
        onEdit={(contact) =>
          setEditingContact({ id: contact.id, name: contact.name })
        }
        onNotFound={closeTarget}
        onOpenRelatedDeals={(contact) => {
          const searchParams = new URLSearchParams({
            contact_id: contact.id,
            contact_name: contact.name,
          })
          window.location.assign(`/app/deals?${searchParams.toString()}`)
        }}
      />
    )
  }

  return (
    <ViewDealModal
      dealId={target.id}
      dealName={target.name}
      onClose={closeTarget}
    />
  )
}

function readDeepLinkTarget(): DeepLinkTarget {
  const searchParams = new URLSearchParams(window.location.search)

  if (window.location.pathname === '/app/contacts') {
    const contactId = searchParams.get('contact_id')?.trim()

    if (contactId) {
      return {
        kind: 'contact',
        id: contactId,
        name: searchParams.get('contact_name')?.trim() || 'Контакт',
      }
    }
  }

  if (window.location.pathname === '/app/deals') {
    const dealId = searchParams.get('deal_id')?.trim()

    if (dealId) {
      return {
        kind: 'deal',
        id: dealId,
        name: searchParams.get('deal_name')?.trim() || 'Сделка',
      }
    }
  }

  return null
}
