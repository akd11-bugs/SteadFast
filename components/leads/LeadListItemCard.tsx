'use client'

import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import type { Lead } from '@/lib/types'
import { formatCurrency, formatRelative, cn } from '@/lib/utils'

// Phone-width stand-in for one DataTable row on /leads: the fields a rep
// scans for (company, contact, stage, value, owner, last touch), tap to open.
export function LeadListItemCard({
  lead,
  stageLabel,
  stageColor,
  selected,
  onToggleSelected,
}: {
  lead: Lead
  stageLabel: string
  stageColor: string | null | undefined
  selected: boolean
  onToggleSelected: () => void
}) {
  const daysSinceActivity = lead.lastActivityAt
    ? Math.floor((Date.now() - new Date(lead.lastActivityAt).getTime()) / 86400000)
    : 999
  const isStale = daysSinceActivity > 21 && lead.stage !== 'onboarding' && lead.stage !== 'not_interested'

  return (
    <div className={cn('flex items-stretch rounded-md border bg-card', selected && 'border-primary/60 bg-accent/40')}>
      <label className="flex shrink-0 cursor-pointer items-center px-3" aria-label={`Select ${lead.company.name}`}>
        <input type="checkbox" className="h-4 w-4" checked={selected} onChange={onToggleSelected} />
      </label>
      <Link href={`/leads/${lead.id}`} className="min-w-0 flex-1 py-3 pr-3">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium leading-tight">{lead.company.name}</p>
          <p className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
            {formatCurrency(lead.estimatedVolume)}
          </p>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {lead.person?.name ?? 'No contact set'}
          {lead.ownerName && <span> · {lead.ownerName}</span>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
            <span
              className="h-2 w-2 rounded-full bg-muted-foreground"
              style={stageColor ? { backgroundColor: stageColor } : undefined}
              aria-hidden="true"
            />
            {stageLabel}
          </span>
          <span className={cn('inline-flex items-center gap-1 text-[11px]', isStale ? 'text-amber-600' : 'text-muted-foreground')}>
            {isStale && <AlertCircle className="h-3 w-3" />}
            {lead.lastActivityAt ? formatRelative(lead.lastActivityAt) : 'no activity'}
          </span>
        </div>
      </Link>
    </div>
  )
}
