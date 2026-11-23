'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Loader2, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { FieldType, Value } from '@/lib/records/fieldTypes'
import {
  api,
  errorMessage,
  findOption,
  formatDate,
  toDraft,
  toValue,
  type Draft,
  type FieldDTO,
  type ObjectTypeDTO,
  type PersonDTO,
  type RecordDTO,
} from '@/lib/records/client'
import { CellValue, FieldInput, useRecordTitles } from './fields'

const PAGE_SIZE = 50

type Op = 'eq' | 'contains' | 'gt' | 'lt' | 'empty' | 'not_empty'
interface Filter {
  field: string
  op: Op
  value?: string | number | boolean
}

function opsFor(type: FieldType): Op[] {
  switch (type) {
    case 'number':
    case 'currency':
    case 'date':
      return ['eq', 'gt', 'lt', 'empty', 'not_empty']
    case 'status':
    case 'select':
    case 'person':
    case 'checkbox':
      return ['eq', 'empty', 'not_empty']
    case 'multi_select':
      return ['contains', 'empty', 'not_empty']
    case 'link':
      return ['empty', 'not_empty']
    default:
      return ['contains', 'eq', 'empty', 'not_empty']
  }
}

function opLabel(op: Op, type: FieldType): string {
  if (type === 'date' && op === 'gt') return 'after'
  if (type === 'date' && op === 'lt') return 'before'
  return { eq: 'is', contains: 'contains', gt: '>', lt: '<', empty: 'is empty', not_empty: 'is not empty' }[op]
}

export function RecordsTable({ object, fields, people }: { object: ObjectTypeDTO; fields: FieldDTO[]; people: PersonDTO[] }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('updatedAt')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<Filter[]>([])
  const [data, setData] = useState<{ records: RecordDTO[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const params = new URLSearchParams({ sort, dir, page: String(page), pageSize: String(PAGE_SIZE) })
  if (query) params.set('q', query)
  if (filters.length) params.set('filters', JSON.stringify(filters))
  const url = `/api/objects/${encodeURIComponent(object.key)}/records?${params}`
  const requestKey = `${url}#${reload}`
  const [doneKey, setDoneKey] = useState('')
  const loading = doneKey !== requestKey

  useEffect(() => {
    const ctrl = new AbortController()
    api<{ records: RecordDTO[]; total: number }>(url, { signal: ctrl.signal })
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e) => !ctrl.signal.aborted && setError(errorMessage(e)))
      .finally(() => !ctrl.signal.aborted && setDoneKey(requestKey))
    return () => ctrl.abort()
  }, [url, requestKey])

  const linkFields = fields.filter((f) => f.type === 'link')
  const title = useRecordTitles(
    (data?.records ?? []).flatMap((r) => linkFields.flatMap((f) => (Array.isArray(r.values[f.key]) ? (r.values[f.key] as string[]) : []))),
  )

  function toggleSort(key: string) {
    if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSort(key)
      setDir('asc')
    }
    setPage(1)
  }

  // The server rejects sorting by these (array or id values with no useful order).
  const UNSORTABLE = new Set(['multi_select', 'person', 'link'])
  const columns: { key: string; label: string; sortable: boolean }[] = [
    ...fields.map((f) => ({ key: f.key, label: f.label, sortable: !UNSORTABLE.has(f.type) })),
    { key: 'updatedAt', label: 'Updated', sortable: true },
  ]
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input aria-label={`Search ${object.name}`} placeholder={`Search ${object.name.toLowerCase()}…`} className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button onClick={() => setCreating(true)} disabled={fields.length === 0}>
          <Plus className="h-4 w-4" />
          New record
        </Button>
      </div>

      <FilterBar
        fields={fields}
        people={people}
        filters={filters}
        onChange={(f) => {
          setFilters(f)
          setPage(1)
        }}
      />

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}>
            Retry
          </Button>
        </div>
      )}

      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">This object has no fields yet. An admin can add them in Settings → Objects.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 font-medium"
                    aria-sort={!c.sortable ? undefined : sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {c.sortable ? (
                      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        {sort === c.key && (dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.records.map((r) => {
                const href = `/records/${encodeURIComponent(object.key)}/${r.id}`
                return (
                  <tr key={r.id} className="cursor-pointer border-t hover:bg-muted/50" onClick={() => router.push(href)}>
                    {fields.map((f, i) => (
                      <td key={f.key} className="max-w-[20rem] px-3 py-2 align-top">
                        {i === 0 && f.type !== 'url' ? (
                          // A real link on the first cell keeps rows reachable by keyboard.
                          <Link href={href} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                            <CellValue field={f} value={r.values[f.key]} people={people} title={title} />
                          </Link>
                        ) : (
                          <CellValue field={f} value={r.values[f.key]} people={people} title={title} />
                        )}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-2 align-top text-muted-foreground">{formatDate(r.updatedAt.slice(0, 10))}</td>
                  </tr>
                )
              })}
              {data && data.records.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                    {query || filters.length ? 'No records match.' : 'No records yet.'}
                  </td>
                </tr>
              )}
              {!data && loading && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-label="Loading" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            {loading && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" aria-label="Loading" />}
          </span>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <NewRecordDialog
        open={creating}
        onOpenChange={setCreating}
        object={object}
        fields={fields}
        people={people}
        onCreated={() => {
          setCreating(false)
          setReload((n) => n + 1)
        }}
      />
    </div>
  )
}

function FilterBar({
  fields,
  people,
  filters,
  onChange,
}: {
  fields: FieldDTO[]
  people: PersonDTO[]
  filters: Filter[]
  onChange: (f: Filter[]) => void
}) {
  const [fieldKey, setFieldKey] = useState('')
  const [op, setOp] = useState<Op>('eq')
  const [value, setValue] = useState('')
  const field = fields.find((f) => f.key === fieldKey)
  const ops = field ? opsFor(field.type) : []
  const needsValue = op !== 'empty' && op !== 'not_empty'

  function pickField(key: string) {
    const f = fields.find((x) => x.key === key)
    setFieldKey(key)
    setOp(f ? opsFor(f.type)[0] : 'eq')
    setValue('')
  }

  function add() {
    if (!field || (needsValue && value === '')) return
    const v =
      !needsValue ? undefined : field.type === 'number' || field.type === 'currency' ? Number(value) : field.type === 'checkbox' ? value === 'true' : value
    onChange([...filters, { field: field.key, op, ...(v === undefined ? {} : { value: v }) }])
    setFieldKey('')
    setValue('')
  }

  function describe(f: Filter): string {
    const fd = fields.find((x) => x.key === f.field)
    if (!fd) return f.field
    let v = f.value === undefined ? '' : String(f.value)
    if (fd.type === 'checkbox') v = f.value ? 'Yes' : 'No'
    else if (fd.type === 'person') v = people.find((p) => p.id === f.value)?.name ?? v
    else if (fd.type === 'date' && v) v = formatDate(v)
    else v = findOption(fd.config, v)?.label ?? v
    return `${fd.label} ${opLabel(f.op, fd.type)}${v ? ` ${v}` : ''}`
  }

  const valueChoices: { key: string; label: string }[] | null = !field
    ? null
    : field.type === 'checkbox'
      ? [
          { key: 'true', label: 'Yes' },
          { key: 'false', label: 'No' },
        ]
      : field.type === 'person'
        ? people.map((p) => ({ key: p.id, label: p.name }))
        : field.config.options ?? null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={fieldKey} onValueChange={pickField}>
          <SelectTrigger className="h-8 w-auto min-w-[9rem]" aria-label="Filter field">
            <SelectValue placeholder="Add filter…" />
          </SelectTrigger>
          <SelectContent>
            {fields.map((f) => (
              <SelectItem key={f.key} value={f.key}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field && (
          <>
            <Select value={op} onValueChange={(v) => setOp(v as Op)}>
              <SelectTrigger className="h-8 w-auto min-w-[7rem]" aria-label="Filter condition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ops.map((o) => (
                  <SelectItem key={o} value={o}>
                    {opLabel(o, field.type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {needsValue &&
              (valueChoices ? (
                <Select value={value} onValueChange={setValue}>
                  <SelectTrigger className="h-8 w-auto min-w-[8rem]" aria-label="Filter value">
                    <SelectValue placeholder="Value" />
                  </SelectTrigger>
                  <SelectContent>
                    {valueChoices.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  aria-label="Filter value"
                  className="h-8 w-40"
                  type={field.type === 'date' ? 'date' : field.type === 'number' || field.type === 'currency' ? 'number' : 'text'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && add()}
                />
              ))}
            <Button size="sm" variant="secondary" onClick={add} disabled={needsValue && value === ''}>
              Apply
            </Button>
          </>
        )}
      </div>
      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
              {describe(f)}
              <button type="button" aria-label={`Remove filter ${describe(f)}`} className="rounded p-0.5 hover:bg-background" onClick={() => onChange(filters.filter((_, j) => j !== i))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange([])}>
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}

function NewRecordDialog({
  open,
  onOpenChange,
  object,
  fields,
  people,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  object: ObjectTypeDTO
  fields: FieldDTO[]
  people: PersonDTO[]
  onCreated: () => void
}) {
  const blank = () => Object.fromEntries(fields.map((f) => [f.key, toDraft(f.type, null)])) as { [key: string]: Draft }
  const [drafts, setDrafts] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const values: { [key: string]: Value } = {}
    for (const f of fields) {
      const v = toValue(f.type, drafts[f.key])
      if (v !== null) values[f.key] = v
    }
    setBusy(true)
    setError(null)
    try {
      await api(`/api/objects/${encodeURIComponent(object.key)}/records`, { method: 'POST', body: { values } })
      setDrafts(blank())
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New record</DialogTitle>
          <DialogDescription>Add a record to {object.name}.</DialogDescription>
        </DialogHeader>
        <form id="new-record-form" onSubmit={submit} className="space-y-3">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`new-${f.key}`}>
                {f.label}
                {f.required && <span className="text-destructive"> *</span>}
              </Label>
              <FieldInput
                id={`new-${f.key}`}
                field={f}
                draft={drafts[f.key]}
                people={people}
                onChange={(d) => setDrafts((prev) => ({ ...prev, [f.key]: d }))}
              />
            </div>
          ))}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="new-record-form" disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
