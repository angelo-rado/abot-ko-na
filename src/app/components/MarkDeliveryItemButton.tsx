'use client'

import { CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface Props {
  deliveryId: string
  itemId: string
  isProcessing: boolean
  onClick: () => void
}

export function MarkDeliveryItemButton({
  deliveryId,
  itemId,
  isProcessing,
  onClick,
}: Props) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={onClick}
            disabled={isProcessing}
            aria-label={`Mark item ${itemId} as received in delivery ${deliveryId}`}
          >
            {isProcessing ? (
              <span className="text-xs">…</span>
            ) : (
              <CheckCircle className="h-5 w-5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Mark item as received</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
