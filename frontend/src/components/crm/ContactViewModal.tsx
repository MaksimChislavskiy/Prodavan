import type { ApiContact } from '../../shared/api/contactsApi'
import { RealtimeContactModal } from './RealtimeContactModal'

type ContactViewModalProps = {
  contactId: string
  contactName: string
  onClose: () => void
  onEdit: (contact: ApiContact) => void
  onNotFound: () => void
  onOpenRelatedDeals: (contact: Pick<ApiContact, 'id' | 'name'>) => void
}

export function ContactViewModal({
  contactId,
  contactName,
  onClose,
  onEdit: _onEdit,
  onNotFound,
  onOpenRelatedDeals,
}: ContactViewModalProps) {
  return (
    <RealtimeContactModal
      contactId={contactId}
      contactName={contactName}
      initialMode="view"
      onClose={onClose}
      onNotFound={onNotFound}
      onOpenRelatedDeals={onOpenRelatedDeals}
    />
  )
}
