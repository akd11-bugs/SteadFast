'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { SavedViewsMenu, type LeadViewFilters } from '@/components/leads/SavedViewsMenu'
import { DataTable, type Calculation } from '@/components/shared/DataTable'
import { LeadListItemCard } from '@/components/leads/LeadListItemCard'
import { getLeadColumns } from '@/lib/tableColumns'
import {
  boardColumnFor,
  boardColumnToInput,
  SOURCES,
  SOURCE_LABELS,
  QUALITY_RANK,
  type Lead,
  type BoardColumnKey,
  type LeadSource,
} from '@/lib/types'
import { usePipelineConfig, useLeadFieldDefinitions } from '@/lib/hooks/usePipelineConfig'

const DEFAULT_COLUMNS = ['company', 'person', 'stage', 'source', 'quality', 'estimatedVolume', 'lastActivityAt', 'ownerName']

interface OwnerOption {
  id: string
  name: string
}

type SortKey = 'date' | 'quality' | 'stage'

const SORT_LABELS: Record<SortKey, string> = {
  date: 'Date (newest first)',
  quality: 'Quality (best first)',
  stage: 'Stage (pipeline order)',
}

export function LeadsTable({
  initialLeads,
  initialQuery,
  initialStage,
  initialSource,
  canReassign = false,
  ownerOptions = [],
}: {
  initialLeads: Lead[]
  initialQuery?: string
  initialStage?: BoardColumnKey
  initialSource?: LeadSource
  canReassign?: boolean
  ownerOptions?: OwnerOption[]
}) {
  const router = useRouter()
  const { columns, pendingSubStatuses } = usePipelineConfig()
  const columnLabels = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c.label])), [columns])
  const columnByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns])
  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns])
  const pendingSubStatusKeys = useMemo(() => pendingSubStatuses.map((s) => s.key), [pendingSubStatuses])
  const [search, setSearch] = useState(initialQuery ?? '')
  const [stageFilter, setStageFilter] = useState<BoardColumnKey | 'all'>(initialStage ?? 'all')
  const [sourceFilter, setSourceFilter] = useState<LeadSource | 'all'>(initialSource ?? 'all')
  // Set only by applying a whiteboard-created segment (a fixed group of
  // leads, not a predicate) — overrides stage/source/search entirely while active.
  const [leadIdFilter, setLeadIdFilter] = useState<Set<string> | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStage, setBulkStage] = useState<BoardColumnKey | ''>('')
  const [bulkOwnerId, setBulkOwnerId] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)
  const [bulkRemarkOpen, setBulkRemarkOpen] = useState(false)
  const [bulkRemark, setBulkRemark] = useState('')
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS)
  const [calculations, setCalculations] = useState<Record<string, Calculation>>({})
  const { fields: customFieldDefs } = useLeadFieldDefinitions()
  const allColumns = useMemo(() => getLeadColumns(customFieldDefs ?? [], columnLabels), [customFieldDefs, columnLabels])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = initialLeads.filter((l) => {
      if (leadIdFilter) return leadIdFilter.has(l.id)
      if (stageFilter !== 'all' && boardColumnFor(l) !== stageFilter) return false
      if (sourceFilter !== 'all' && l.source !== sourceFilter) return false
      if (q && !(`${l.company.name} ${l.person?.name ?? ''} ${l.email} ${l.industry ?? ''}`.toLowerCase().includes(q))) return false
      return true
    })

    const sorted = [...rows]
    if (sortKey === 'date') {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    } else if (sortKey === 'quality') {
      sorted.sort((a, b) => QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality])
    } else if (sortKey === 'stage') {
      sorted.sort((a, b) => columnKeys.indexOf(boardColumnFor(a)) - columnKeys.indexOf(boardColumnFor(b)))
    }
    return sorted
  }, [initialLeads, search, stageFilter, sourceFilter, sortKey, columnKeys, leadIdFilter])

  const allVisibleSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id))

  function toggleAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev)
        for (const l of filtered) next.delete(l.id)
        return next
      }
      const next = new Set(prev)
      for (const l of filtered) next.add(l.id)
      return next
    })
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runBulkAction(action: 'stage' | 'reassign', remark?: string) {
    if (selected.size === 0) return
    setBulkBusy(true)
    setBulkMessage(null)
    try {
      const owner = ownerOptions.find((o) => o.id === bulkOwnerId)
      const res = await fetch('/api/leads/bulk', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          leadIds: Array.from(selected),
          action,
          ...(action === 'stage' && bulkStage && { ...boardColumnToInput(bulkStage, pendingSubStatusKeys), remark }),
          ...(action === 'reassign' && { ownerId: owner?.id }),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setBulkMessage(data.error ?? 'Bulk update failed')
        return
      }
      setBulkMessage(
        data.skipped > 0
          ? `Updated ${data.updated} of ${data.requested} (${data.skipped} out of scope)`
          : `Updated ${data.updated} lead${data.updated === 1 ? '' : 's'}`
      )
      setSelected(new Set())
      router.refresh()
    } finally {
      setBulkBusy(false)
    }
  }

  async function confirmBulkStageChange() {
    const remark = bulkRemark.trim()
    if (!remark) return
    await runBulkAction('stage', remark)
    setBulkRemarkOpen(false)
    setBulkRemark('')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by company, POC, email, industry…"
            className="pl-9 h-9"
          />
        </div>
        <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as BoardColumnKey | 'all')}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as LeadSource | 'all')}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
          <SelectTrigger className="h-9 w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                Sort: {SORT_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SavedViewsMenu<LeadViewFilters>
          viewType="leads"
          filters={{ search, stageFilter, sourceFilter, sortKey, columns: visibleColumns, calculations }}
          onApply={(v) => {
            if (v.leadIds?.length) {
              setLeadIdFilter(new Set(v.leadIds))
              return
            }
            setLeadIdFilter(null)
            setSearch(v.search)
            setStageFilter(columnKeys.includes(v.stageFilter) ? (v.stageFilter as BoardColumnKey) : 'all')
            setSourceFilter((SOURCES as string[]).includes(v.sourceFilter) ? (v.sourceFilter as LeadSource) : 'all')
            setSortKey((Object.keys(SORT_LABELS) as string[]).includes(v.sortKey) ? (v.sortKey as SortKey) : 'date')
            if (v.columns?.length) setVisibleColumns(v.columns)
            if (v.calculations) setCalculations(v.calculations as Record<string, Calculation>)
          }}
        />
        {leadIdFilter && (
          <Badge variant="outline" className="gap-1.5">
            Segment · {leadIdFilter.size} leads
            <button type="button" className="ml-1 text-muted-foreground hover:text-foreground" onClick={() => setLeadIdFilter(null)}>
              <X className="h-3 w-3" />
            </button>
          </Badge>
        )}
        <span className="ml-auto text-sm text-muted-foreground">
          {filtered.length} of {initialLeads.length} leads
        </span>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-accent/40 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Select value={bulkStage} onValueChange={(v) => setBulkStage(v as BoardColumnKey)}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder="Move to stage…" />
            </SelectTrigger>
            <SelectContent>
              {columns.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={!bulkStage || bulkBusy} onClick={() => setBulkRemarkOpen(true)}>
            {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Apply stage
          </Button>
          {canReassign && (
            <>
              <Select value={bulkOwnerId} onValueChange={setBulkOwnerId}>
                <SelectTrigger className="h-8 w-44">
                  <SelectValue placeholder="Reassign to…" />
                </SelectTrigger>
                <SelectContent>
                  {ownerOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" disabled={!bulkOwnerId || bulkBusy} onClick={() => runBulkAction('reassign')}>
                {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Reassign
              </Button>
            </>
          )}
          {bulkMessage && <span className="text-xs text-muted-foreground">{bulkMessage}</span>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Below md an 8+ column table is unreadable even with sideways scroll,
          so phones get one card per lead instead. Selection is shared, so the
          bulk-action bar above works the same on both. */}
      <div className="space-y-2 md:hidden">
        {filtered.length === 0 ? (
          <p className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">No leads match these filters.</p>
        ) : (
          filtered.map((l) => {
            const col = columnByKey.get(boardColumnFor(l))
            return (
              <LeadListItemCard
                key={l.id}
                lead={l}
                stageLabel={col?.label ?? l.stage}
                stageColor={col?.color}
                selected={selected.has(l.id)}
                onToggleSelected={() => toggleOne(l.id)}
              />
            )
          })
        )}
      </div>

      <div className="hidden md:block">
      <DataTable
        tableId="leads-table"
        rows={filtered}
        rowKey={(l) => l.id}
        rowHref={(l) => `/leads/${l.id}`}
        allColumns={allColumns}
        visibleColumnKeys={visibleColumns}
        calculations={calculations}
        onColumnsChange={setVisibleColumns}
        onCalculationsChange={setCalculations}
        selection={{
          selectedKeys: selected,
          onToggleOne: toggleOne,
          onToggleAll: toggleAllVisible,
          allSelected: allVisibleSelected,
        }}
      />
      </div>

      <Dialog open={bulkRemarkOpen} onOpenChange={(o) => { setBulkRemarkOpen(o); if (!o) setBulkRemark('') }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move {selected.size} lead{selected.size === 1 ? '' : 's'} to {bulkStage ? columnLabels[bulkStage] : ''}</DialogTitle>
            <DialogDescription>
              One remark, logged identically to every selected lead&apos;s activity timeline.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={4}
            placeholder="What happened?"
            value={bulkRemark}
            onChange={(e) => setBulkRemark(e.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkRemarkOpen(false)} disabled={bulkBusy}>
              Cancel
            </Button>
            <Button onClick={confirmBulkStageChange} disabled={bulkBusy || !bulkRemark.trim()}>
              {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}