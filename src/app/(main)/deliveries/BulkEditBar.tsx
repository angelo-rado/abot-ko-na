'use client'

import { Button } from '@/components/ui/button'
import { Trash2, Pencil, X } from 'lucide-react'

export default function BulkEditBar({
  visible,
  selectedCount,
  onEdit,
  onDelete,
  onCancel,
}: {
  visible: boolean
  selectedCount: number
  onEdit?: () => void
  onDelete?: () => void
  onCancel?: () => void
}) {
  return (
    <div
      className={[
        // sticky inside the scroll container (the pane)
        'sticky bottom-0 z-40',
        // visual
        'border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75',
        // slide in/out
        'transition-transform duration-200',
        visible ? 'translate-y-0' : 'translate-y-full',
      ].join(' ')}
    >
      <div className="max-w-xl mx-auto px-3 py-2 flex items-center justify-between gap-3">
        <div className="text-sm">
          {selectedCount > 0 ? (
            <span><strong>{selectedCount}</strong> selected</span>
          ) : (
            <span>Select items to edit</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onEdit}
            disabled={!visible || selectedCount === 0}
            className="gap-1"
          >
            <Pencil className="w-4 h-4" /> Edit
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={onDelete}
            disabled={!visible || selectedCount === 0}
            className="gap-1"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} className="gap-1">
            <X className="w-4 h-4" /> Done
          </Button>
        </div>
      </div>
    </div>
  )
}
