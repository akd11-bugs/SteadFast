'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, GripVertical, X } from 'lucide-react'
import type { TableColumn } from '@/lib/tableColumns'

export type Calculation = 'none' | 'count' | 'sum' | 'avg'

/**
 * A generic, Attio-style table: columns are user-chosen (add/remove/reorder)
 * from a registry rather than hardcoded, and each visible column can show a
 * footer calculation (Count/Sum/Average) computed from the rows already on
 * screen. Used by both the Leads table and the Companies list — the column
 * registry (lib/tableColumns.ts) is what actually differs between them.
 */
export function DataTable<TRow>({
  tableId,
  rows,
  rowKey,
  rowHref,
  allColumns,
  visibleColumnKeys,
  calculations,
  onColumnsChange,
  onCalculationsChange,
  selection,
}: {
  // Seeds dnd-kit's internal aria-describedby id generator deterministically
  // — without this, its auto-incrementing counter can differ between the
  // server-rendered markup and the client's first render (depending on how
  // many other DndContext instances mounted earlier on the page, e.g. the
  // Kanban board), producing a harmless but noisy hydration-mismatch warning.
  tableId: string
  rows: TRow[]
  rowKey: (row: TRow) => string
  rowHref: (row: TRow) => string
  allColumns: TableColumn<TRow>[]
  visibleColumnKeys: string[]
  calculations: Record<string, Calculation>
  onColumnsChange: (keys: string[]) => void
  onCalculationsChange: (calcs: Record<string, Calculation>) => void
  // Pinned checkbox column, separate from the dynamic data columns (same
  // split Attio itself has) — omit entirely for a table with no bulk actions.
  selection?: {
    selectedKeys: Set<string>
    onToggleOne: (key: string) => void
    onToggleAll: () => void
    allSelected: boolean
  }
}) {
  const router = useRouter()
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const columnsByKey = new Map(allColumns.map((c) => [c.key, c]))
  const visibleColumns = visibleColumnKeys.map((k) => columnsByKey.get(k)).filter((c): c is TableColumn<TRow> => !!c)
  const hiddenColumns = allColumns.filter((c) => !visibleColumnKeys.includes(c.key))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = visibleColumnKeys.indexOf(String(active.id))
    const newIndex = visibleColumnKeys.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    onColumnsChange(arrayMove(visibleColumnKeys, oldIndex, newIndex))
  }

  function removeColumn(key: string) {
    onColumnsChange(visibleColumnKeys.filter((k) => k !== key))
    if (calculations[key]) {
      const next = { ...calculations }
      delete next[key]
      onCalculationsChange(next)
    }
  }

  function addColumn(key: string) {
    onColumnsChange([...visibleColumnKeys, key])
  }

  function setCalculation(key: string, calc: Calculation) {
    onCalculationsChange({ ...calculations, [key]: calc })
  }

  function calcValue(column: TableColumn<TRow>, calc: Calculation): string | null {
    if (calc === 'none') return null
    if (calc === 'count') return String(rows.length)
    if (!column.getNumericValue) return null
    const nums = rows.map((r) => column.getNumericValue!(r)).filter((n): n is number => typeof n === 'number')
    if (nums.length === 0) return '—'
    const sum = nums.reduce((a, b) => a + b, 0)
    return calc === 'sum' ? sum.toLocaleString('en-IN') : (sum / nums.length).toLocaleString('en-IN', { maximumFractionDigits: 1 })
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <DndContext id={tableId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
            <SortableContext items={visibleColumnKeys} strategy={horizontalListSortingStrategy}>
              <tr>
                {selection && (
                  <th className="w-8 px-3 py-2">
                    <input type="checkbox" checked={selection.allSelected} onChange={selection.onToggleAll} aria-label="Select all visible rows" />
                  </th>
                )}
                {visibleColumns.map((col) => (
                  <SortableHeaderCell key={col.key} id={col.key} label={col.label} onRemove={() => removeColumn(col.key)} />
                ))}
                <th className="w-10 px-2 py-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Add column">
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {hiddenColumns.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">All columns added</div>
                      )}
                      {hiddenColumns.map((c) => (
                        <DropdownMenuItem key={c.key} onClick={() => addColumn(c.key)}>
                          {c.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </th>
              </tr>
            </SortableContext>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 && (
            <tr>
              <td colSpan={visibleColumns.length + 1 + (selection ? 1 : 0)} className="px-3 py-6 text-center text-sm text-muted-foreground">
                No records.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-muted/30 cursor-pointer" onClick={() => router.push(rowHref(row))}>
              {selection && (
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selection.selectedKeys.has(rowKey(row))}
                    onChange={() => selection.onToggleOne(rowKey(row))}
                    aria-label={`Select ${rowKey(row)}`}
                  />
                </td>
              )}
              {visibleColumns.map((col) => (
                <td key={col.key} className="px-3 py-2 truncate max-w-[220px]">
                  {col.getValue(row)}
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="border-t bg-muted/20">
            <tr>
              {selection && <td />}
              {visibleColumns.map((col) => (
                <td key={col.key} className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <Select value={calculations[col.key] ?? 'none'} onValueChange={(v) => setCalculation(col.key, v as Calculation)}>
                      <SelectTrigger className="h-6 text-[10px] px-1.5 border-none bg-transparent shadow-none text-muted-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        <SelectItem value="count">Count</SelectItem>
                        {col.getNumericValue && <SelectItem value="sum">Sum</SelectItem>}
                        {col.getNumericValue && <SelectItem value="avg">Average</SelectItem>}
                      </SelectContent>
                    </Select>
                    {calculations[col.key] && calculations[col.key] !== 'none' && (
                      <span className="text-xs font-medium">{calcValue(col, calculations[col.key])}</span>
                    )}
                  </div>
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        )}
      </table>
      </DndContext>
    </div>
  )
}

function SortableHeaderCell({ id, label, onRemove }: { id: string; label: string; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const [hovering, setHovering] = useState(false)

  return (
    <th
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="px-3 py-2 text-left font-medium whitespace-nowrap select-none"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="flex items-center gap-1">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground/60 hover:text-muted-foreground" aria-label={`Reorder ${label}`}>
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span>{label}</span>
        {hovering && (
          <button onClick={onRemove} className="ml-auto text-muted-foreground/60 hover:text-destructive" aria-label={`Remove ${label} column`}>
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </th>
  )
}
