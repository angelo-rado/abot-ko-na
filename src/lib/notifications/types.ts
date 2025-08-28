export type NotificationType =
  | 'delivery_created'
  | 'delivery_updated'
  | 'delivery_delivered'
  | 'presence_changed'
  | 'note_added'
  | 'invite'
  | 'system'
  | string

export type NotificationDoc = {
  id: string
  familyId?: string | null
  type: NotificationType
  title?: string | null
  body?: string | null
  createdAt?: any // Firestore Timestamp | Date | string | number
  link?: string | null
  reads?: Record<string, any> | null
  targets?: string[] | null
  meta?: Record<string, any> | null
  // internal
  _path?: string
}