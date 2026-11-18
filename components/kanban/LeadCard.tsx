'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Lead, BoardColumnKey } from '@/lib/types'
import { SOURCE_LABELS, boardColumnFor } from '@/lib/types'
import type { BoardColumn } from '@/lib/boardColumns'
import { formatCurrency, formatRelative, cn } from '@/lib/utils'
import { AlertCircle, ArrowRightLeft } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface LeadCardProps {
  lead: Lead
  onClick: (lead: Lead) => void
  isDragging?: boolean
  moveTargets?: BoardColumn[]
  onMove?: (lead: Lead, target: BoardColumnKey) => void
}

// Keeps a tap/click/keypress inside the move menu from reaching the card's
// drag listeners or its open-detail onClick. React portal events still
// bubble through this wrapper, so the menu items are covered too.
const stop = (e: React.SyntheticEvent) => e.stopPropagation()

export function LeadCard({ lead, onClick, isDragging, moveTargets, onMove }: LeadCardProps) {
  const sortable = useSortable({ id: lead.id })
  const style = isDragging
    ? { opacity: 1 }
    : {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }

  const daysSinceActivity = lead.lastActivityAt
    ? Math.floor((Date.now() - new Date(lead.lastActivityAt).getTime()) / 86400000)
    : 999

  const isStale = daysSinceActivity > 21 && lead.stage !== 'onboarding' && lead.stage !== 'not_interested'

  return (
    <div
      ref={isDragging ? undefined : sortable.setNodeRef}
      style={style}
      {...(isDragging ? {} : sortable.attributes)}
      {...(isDragging ? {} : sortable.listeners)}
      className={cn(
        'group rounded-md border bg-card shadow-sm hover:shadow-md hover:border-blue-300 transition-all cursor-pointer touch-manipulation',
        sortable.isDragging && 'opacity-50'
      )}
      onClick={() => !isDragging && onClick(lead)}
    >
      <div className="flex items-start gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium leading-tight truncate">{lead.company.name}</p>
            <p className="text-xs font-semibold tabular-nums text-muted-foreground shrink-0">
              {formatCurrency(lead.estimatedVolume)}
            </p>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {lead.industry || 'Industry not set'}
            {lead.person?.name && <span> · {lead.person.name}</span>}
          </p>
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
              {SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS] ?? lead.source}
            </span>
            <span className={cn('inline-flex items-center gap-1 text-[10px]', isStale ? 'text-amber-600' : 'text-muted-foreground')}>
              {isStale && <AlertCircle className="h-3 w-3" />}
              {lead.lastActivityAt ? formatRelative(lead.lastActivityAt) : 'no activity'}
            </span>
            {!isDragging && moveTargets && onMove && (
              <div
                className="ml-auto"
                onClick={stop}
                onMouseDown={stop}
                onTouchStart={stop}
                onPointerDown={stop}
                onKeyDown={stop}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="-my-1 -mr-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Move ${lead.company.name} to another stage`}
                    title="Move to stage"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Move to stage</DropdownMenuLabel>
                    {moveTargets
                      .filter((c) => c.key !== boardColumnFor(lead))
                      .map((c) => (
                        <DropdownMenuItem key={c.key} onSelect={() => onMove(lead, c.key)}>
                          <span
                            className="mr-2 h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: c.color ?? '#64748b' }}
                            aria-hidden="true"
                          />
                          {c.label}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}