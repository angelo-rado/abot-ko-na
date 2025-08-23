'use client'

import { Button } from '@/components/ui/button'

type Props = {
  visible?: boolean
  selectedCount: number
  onEdit: () => void
  onDelete: () => void
  onCancel: () => void
}

export default function BulkEditBar({
  visible = false,
  selectedCount,
  onEdit,
  onDelete,
  onCancel,
}: Props) {
  if (!visible) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow">
      <div className="mx-auto max-w-4xl px-4 py-3 flex items-center justify-between gap-3">
        <div className="text-sm">
          {selectedCount > 0 ? (
            <span>
              <strong>{selectedCount}</strong> selected
            </span>
          ) : (
            <span className="text-muted-foreground">Select items to edit or delete</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onEdit}
            disabled={selectedCount !== 1}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onDelete}
            disabled={selectedCount === 0}
          >
            Delete
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

