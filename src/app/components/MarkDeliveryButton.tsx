'use client'

import { CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface MarkDeliveryButtonProps {
  id: string
  isProcessing: boolean
  onClick: () => void
}

export function MarkDeliveryButton({
  id,
  isProcessing,
  onClick,
}: MarkDeliveryButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={onClick}
            disabled={isProcessing}
            aria-label={`Mark delivery ${id} as received`}
          >
            {isProcessing ? (
              <span className="text-xs">…</span>
            ) : (
              <CheckCircle className="h-5 w-5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Mark as received</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )

}

