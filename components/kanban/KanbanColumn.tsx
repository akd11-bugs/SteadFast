'use client'

import { useDroppable } from '@dnd-kit/core'
import { LeadCard } from './LeadCard'
import type { Lead, BoardColumnKey } from '@/lib/types'
import type { BoardColumn } from '@/lib/hooks/usePipelineConfig'
import { formatCurrency, cn } from '@/lib/utils'

interface KanbanColumnProps {
  column: BoardColumn
  leads: Lead[]
  onCardClick: (lead: Lead) => void
  moveTargets: BoardColumn[]
  onMove: (lead: Lead, target: BoardColumnKey) => void
}

export function KanbanColumn({ column, leads, onCardClick, moveTargets, onMove }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${column.key}`,
    data: { type: 'column', columnKey: column.key },
  })

  const totalValue = leads.reduce((sum, l) => sum + l.estimatedVolume, 0)

  return (
    <div className="w-72 shrink-0">
      <div className="flex items-center justify-between gap-2 px-1 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: column.color ?? '#64748b' }}
          />
          <h3 className="text-sm font-semibold truncate">{column.label}</h3>
          <span className="text-xs text-muted-foreground">{leads.length}</span>
        </div>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {formatCurrency(totalValue)}
        </span>
      </div>
      {column.description && (
        <p className="px-1 mb-2 text-[11px] text-muted-foreground line-clamp-1">{column.description}</p>
      )}
      <div
        ref={setNodeRef}
        className={cn(
          'space-y-2 rounded-lg border-2 border-dashed border-muted/50 bg-muted/20 p-2 min-h-[400px] transition-colors',
          isOver && 'border-blue-400 bg-blue-50/50'
        )}
      >
        {leads.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
            No leads in this stage
          </div>
        ) : (
          leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onClick={onCardClick} moveTargets={moveTargets} onMove={onMove} />
          ))
        )}
      </div>
    </div>
  )
}
