import {
  RealtimeDealModal,
  type RealtimeDealModalProps,
} from './RealtimeDealModal'

export function ViewDealModal(props: RealtimeDealModalProps) {
  return <RealtimeDealModal {...props} initialMode="view" />
}
