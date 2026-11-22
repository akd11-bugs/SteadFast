'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Mail, Trash2, Loader2 } from 'lucide-react'
import { boardColumnFor, type Lead } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'
import { usePipelineConfig } from '@/lib/hooks/usePipelineConfig'
import { LeadRecordView } from './LeadRecordView'

export function LeadDetailDialog({
  leadId,
  open,
  onOpenChange,
  onLeadUpdated,
}: {
  leadId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // Lets the Kanban board underneath (this dialog opens from a card click)
  // move the card live the moment a stage/pending-sub-status change is
  // confirmed here, without waiting for a close + page refresh.
  onLeadUpdated?: (lead: Lead) => void
}) {
  const [lead, setLead] = useState<Lead | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const { columns } = usePipelineConfig()

  useEffect(() => {
    if (!open) return
    setLead(null)
    setLoadFailed(false)
    fetch(`/api/leads/${leadId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => (data?.lead ? setLead(data.lead) : setLoadFailed(true)))
      .catch(() => setLoadFailed(true))
  }, [open, leadId])

  if (!open) return null

  if (!lead) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          {loadFailed ? (
            <p role="alert" className="text-sm text-muted-foreground">
              Couldn&apos;t open this lead. It may have been deleted or you may be offline.
            </p>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <LeadRecordView
          key={lead.id}
          initialLead={lead}
          onLeadChange={(updated) => {
            setLead(updated)
            onLeadUpdated?.(updated)
          }}
          onDeleted={() => onOpenChange(false)}
          renderHeader={({ lead: l, setActiveTab, deleteLead }) => (
            <DialogHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <DialogTitle className="text-xl truncate">{l.company.name}</DialogTitle>
                  <DialogDescription asChild>
                    <div className="flex items-center gap-2 mt-1">
                      {l.person?.name && (
                        <>
                          <span className="font-medium text-foreground">{l.person.name}</span>
                          <span>·</span>
                        </>
                      )}
                      <span>{formatCurrency(l.estimatedVolume)}</span>
                      <span>·</span>
                      <Badge variant="outline" className="capitalize">
                        {columns.find((c) => c.key === boardColumnFor(l))?.label ?? boardColumnFor(l)}
                      </Badge>
                    </div>
                  </DialogDescription>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setActiveTab('activities')}>
                    <Mail className="h-3.5 w-3.5" />
                    Send email
                  </Button>
                  <Button variant="ghost" size="icon" onClick={deleteLead} aria-label="Delete lead">
                    <Trash2 className="h-4 w-4 text-rose-500" />
                  </Button>
                </div>
              </div>
            </DialogHeader>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
