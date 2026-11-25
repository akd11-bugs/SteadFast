'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { KanbanColumn } from './KanbanColumn'
import { LeadCard } from './LeadCard'
import { LeadDetailDialog } from '@/components/leads/LeadDetailDialog'
import { StageChangeDialog } from '@/components/leads/StageChangeDialog'
import type { Lead, BoardColumnKey } from '@/lib/types'
import { boardColumnFor } from '@/lib/types'
import { usePipelineConfig } from '@/lib/hooks/usePipelineConfig'
import { Loader2, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface KanbanBoardProps {
  initialLeads: Lead[]
}

export function KanbanBoard({ initialLeads }: KanbanBoardProps) {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [activeLead, setActiveLead] = useState<Lead | null>(null)
  const [detailLead, setDetailLead] = useState<Lead | null>(null)
  const [stageChange, setStageChange] = useState<{ leadId: string; target: BoardColumnKey; targetLabel: string } | null>(null)
  const { columns, pendingSubStatuses, loading: columnsLoading } = usePipelineConfig()
  const [search, setSearch] = useState('')

  function applyUpdatedLead(updated: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)))
    // Keeps other pages (Dashboard, Leads table) from serving a stale cached
    // view the next time they're navigated to — the board itself already
    // reflects the change via local state above, no reload needed here.
    router.refresh()
  }

  useEffect(() => {
    setLeads(initialLeads)
  }, [initialLeads])

  // Mouse drags start after 6px. Touch drags need a 200ms long-press, so a
  // normal swipe across cards still scrolls the board instead of grabbing a
  // card (cards use touch-action: manipulation, not none, for that reason).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function openMove(lead: Lead, target: BoardColumnKey) {
    if (boardColumnFor(lead) === target) return
    const targetLabel = columns.find((c) => c.key === target)?.label ?? target
    setStageChange({ leadId: lead.id, target, targetLabel })
  }

  const leadsByColumn = useMemo(() => {
    const map = new Map<BoardColumnKey, Lead[]>()
    for (const column of columns) {
      map.set(column.key, [])
    }
    // Same fields as the Leads table search, plus phone.
    const q = search.trim().toLowerCase()
    for (const lead of leads) {
      if (q && !`${lead.company.name} ${lead.person?.name ?? ''} ${lead.email} ${lead.phone ?? ''} ${lead.industry ?? ''}`.toLowerCase().includes(q)) continue
      const list = map.get(boardColumnFor(lead))
      if (list) list.push(lead)
    }
    // Sort by position
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position)
    }
    return map
  }, [leads, columns, search])

  function handleDragStart(e: DragStartEvent) {
    const lead = leads.find((l) => l.id === e.active.id)
    if (lead) setActiveLead(lead)
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveLead(null)
    if (!e.over) return

    const leadId = e.active.id as string
    const overId = e.over.id as string
    const overData = e.over.data.current as { type?: string; columnKey?: BoardColumnKey } | undefined

    // Dropping on the column's empty area gives us the column directly.
    // Dropping on top of another card doesn't — resolve via that card's own column.
    const lead = leads.find((l) => l.id === leadId)
    if (!lead) return
    const overLead = leads.find((l) => l.id === overId)
    const targetColumn = overData?.type === 'column' ? overData.columnKey : overLead ? boardColumnFor(overLead) : undefined

    if (!targetColumn || boardColumnFor(lead) === targetColumn) return

    // No optimistic move and no direct PATCH here — a remark is required for
    // every stage/sub-status change, so this just opens the same dialog the
    // detail form uses. The card only actually moves once that's confirmed
    // (onDone).
    const targetLabel = columns.find((c) => c.key === targetColumn)?.label ?? targetColumn
    setStageChange({ leadId, target: targetColumn, targetLabel })
  }

  if (columnsLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading pipeline…
      </div>
    )
  }

  const matchCount = search.trim() ? [...leadsByColumn.values()].reduce((n, l) => n + l.length, 0) : null

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by company, POC, email, phone…"
            aria-label="Search leads on the board"
            className="pl-9 h-9"
          />
        </div>
        {matchCount !== null && (
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {matchCount} match{matchCount === 1 ? '' : 'es'}
          </span>
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="kanban-scroll overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {columns.map((column) => {
              const columnLeads = leadsByColumn.get(column.key) ?? []
              return (
                <SortableContext key={column.key} items={columnLeads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                  <KanbanColumn
                    column={column}
                    leads={columnLeads}
                    onCardClick={setDetailLead}
                    moveTargets={columns}
                    onMove={openMove}
                  />
                </SortableContext>
              )
            })}
          </div>
        </div>
        <DragOverlay>
          {activeLead ? (
            <div className="rotate-1 opacity-90">
              <LeadCard lead={activeLead} onClick={() => {}} isDragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {detailLead && (
        <LeadDetailDialog
          leadId={detailLead.id}
          open={!!detailLead}
          onOpenChange={(open) => !open && setDetailLead(null)}
          onLeadUpdated={applyUpdatedLead}
        />
      )}

      {stageChange && (
        <StageChangeDialog
          leadId={stageChange.leadId}
          open
          onOpenChange={(open) => !open && setStageChange(null)}
          target={stageChange.target}
          targetLabel={stageChange.targetLabel}
          pendingSubStatusKeys={pendingSubStatuses.map((s) => s.key)}
          onDone={applyUpdatedLead}
        />
      )}
    </>
  )
}
