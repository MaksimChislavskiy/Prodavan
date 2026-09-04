import {
  RealtimeDealModal,
  type RealtimeDealModalProps,
} from './RealtimeDealModal'

export function EditDealModal(props: RealtimeDealModalProps) {
  return <RealtimeDealModal {...props} initialMode="edit" />
}
