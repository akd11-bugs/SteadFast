'use client'

import { useEffect, useReducer, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { FieldOption, Value } from '@/lib/records/fieldTypes'
import {
  api,
  errorMessage,
  findOption,
  formatCurrency,
  formatDate,
  formatNumber,
  recordTitle,
  type Draft,
  type FieldDTO,
  type PersonDTO,
  type RecordDTO,
} from '@/lib/records/client'

// Radix Select can't hold '' as an item value.
const NONE = '__none__'

// ---- linked-record titles ---------------------------------------------
// shortcut: one GET /api/records/:id per unseen linked id (cached for the tab's life); add a batch endpoint if pages with many links get slow.
const titleCache = new Map<string, string>()
const inflight = new Map<string, Promise<void>>()

function loadTitle(id: string): Promise<void> {
  const pending = inflight.get(id)
  if (pending) return pending
  const p = api<{ record: RecordDTO; fields: FieldDTO[] }>(`/api/records/${encodeURIComponent(id)}`)
    .then((d) => void titleCache.set(id, recordTitle(d.fields, d.record.values, id)))
    // Display-only fallback (deleted or hidden record): show the id, as specified.
    .catch(() => void titleCache.set(id, id))
    .finally(() => inflight.delete(id))
  inflight.set(id, p)
  return p
}

export function primeTitle(id: string, title: string) {
  titleCache.set(id, title)
}

export function useRecordTitles(ids: string[]): (id: string) => string {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const key = [...new Set(ids)].sort().join(',')
  useEffect(() => {
    const missing = key ? key.split(',').filter((id) => !titleCache.has(id)) : []
    if (!missing.length) return
    let alive = true
    void Promise.all(missing.map(loadTitle)).then(() => alive && bump())
    return () => {
      alive = false
    }
  }, [key])
  return (id) => titleCache.get(id) ?? id
}

// ---- display ----------------------------------------------------------
export function OptionBadge({ option }: { option: FieldOption }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-medium whitespace-nowrap">
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground" style={option.color ? { backgroundColor: option.color } : undefined} />
      {option.label}
    </Badge>
  )
}

export function CellValue({
  field,
  value,
  people,
  title,
}: {
  field: FieldDTO
  value: Value | undefined
  people: PersonDTO[]
  title: (id: string) => string
}) {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">—</span>
  switch (field.type) {
    case 'status':
    case 'select': {
      const o = findOption(field.config, String(value))
      return o ? <OptionBadge option={o} /> : <span className="text-muted-foreground">{String(value)}</span>
    }
    case 'multi_select':
      return (
        <span className="flex flex-wrap gap-1">
          {(Array.isArray(value) ? value : []).map((k) => {
            const o = findOption(field.config, k)
            return o ? <OptionBadge key={k} option={o} /> : null
          })}
        </span>
      )
    case 'checkbox':
      return value === true ? <Check className="h-4 w-4" aria-label="Yes" /> : <span className="sr-only">No</span>
    case 'url':
      // Server only stores http(s) URLs (fieldTypes.ts validateValue).
      return (
        <a href={String(value)} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
          {String(value).replace(/^https?:\/\//, '')}
        </a>
      )
    case 'date':
      return <>{formatDate(String(value))}</>
    case 'number':
      return <>{typeof value === 'number' ? formatNumber(value) : String(value)}</>
    case 'currency':
      return <>{typeof value === 'number' ? formatCurrency(value, field.config.currency) : String(value)}</>
    case 'person':
      return <>{people.find((p) => p.id === value)?.name ?? 'Unknown user'}</>
    case 'link':
      return <>{(Array.isArray(value) ? value : []).map(title).join(', ')}</>
    default:
      return <>{String(value)}</>
  }
}

// ---- inputs -----------------------------------------------------------
// Controlled input for one field. `onBlur` lets the detail page save text-like
// inputs when the user leaves them; everything else reports via onChange.
export function FieldInput({
  field,
  draft,
  onChange,
  onBlur,
  people,
  id,
}: {
  field: FieldDTO
  draft: Draft
  onChange: (d: Draft) => void
  onBlur?: () => void
  people: PersonDTO[]
  id: string
}) {
  const [badDate, setBadDate] = useState(false)
  const s = typeof draft === 'string' ? draft : ''
  switch (field.type) {
    case 'long_text':
      return <Textarea id={id} rows={3} value={s} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    case 'checkbox':
      return (
        <input
          id={id}
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={draft === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      )
    case 'status':
    case 'select':
    case 'person': {
      // Deactivated users can't be newly picked, but a current pick stays visible.
      const items =
        field.type === 'person'
          ? people
              .filter((p) => p.isActive || p.id === s)
              .map((p) => ({ key: p.id, label: p.isActive ? p.name : `${p.name} (inactive)` }))
          : (field.config.options ?? [])
      return (
        <Select value={s || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
          <SelectTrigger id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              <span className="text-muted-foreground">None</span>
            </SelectItem>
            {items.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    case 'multi_select': {
      const picked = Array.isArray(draft) ? draft : []
      return (
        <div id={id} role="group" className="flex flex-wrap gap-1.5">
          {(field.config.options ?? []).map((o) => {
            const on = picked.includes(o.key)
            return (
              <button
                key={o.key}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? picked.filter((k) => k !== o.key) : [...picked, o.key])}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
                  on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <span aria-hidden className="h-2 w-2 rounded-full bg-muted-foreground" style={o.color ? { backgroundColor: o.color } : undefined} />
                {o.label}
              </button>
            )
          })}
        </div>
      )
    }
    case 'link':
      return <LinkPicker id={id} field={field} ids={Array.isArray(draft) ? draft : []} onChange={onChange} />
    default: {
      // Numbers are text so bad input reaches the server (type=number reports '' and would clear the value).
      const inputType =
        field.type === 'number' || field.type === 'currency'
          ? 'text'
          : field.type === 'date'
            ? 'date'
            : field.type === 'email'
              ? 'email'
              : field.type === 'url'
                ? 'url'
                : field.type === 'phone'
                  ? 'tel'
                  : 'text'
      const numeric = field.type === 'number' || field.type === 'currency'
      const input = (
        <Input
          id={id}
          type={inputType}
          inputMode={numeric ? 'decimal' : undefined}
          value={s}
          onChange={(e) => {
            if (field.type === 'date') setBadDate(e.currentTarget.validity.badInput)
            onChange(e.target.value)
          }}
          onBlur={(e) => {
            // A half-typed date reads as '' — saving it would clear the stored date.
            if (field.type === 'date' && e.currentTarget.validity.badInput) return setBadDate(true)
            onBlur?.()
          }}
          aria-invalid={badDate || undefined}
        />
      )
      // Same wrapper either way: swapping it would remount the input mid-edit and drop focus (and the blur save).
      return (
        <div className="space-y-1">
          {input}
          {badDate && <p className="text-xs text-destructive">Enter a full date</p>}
        </div>
      )
    }
  }
}

function LinkPicker({ id, field, ids, onChange }: { id: string; field: FieldDTO; ids: string[]; onChange: (d: Draft) => void }) {
  const target = field.config.targetObjectTypeId ?? ''
  const title = useRecordTitles(ids)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; title: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [targetFields, setTargetFields] = useState<FieldDTO[] | null>(null)

  useEffect(() => {
    if (!target) return
    let alive = true
    api<{ fields: FieldDTO[] }>(`/api/objects/${encodeURIComponent(target)}/fields`)
      .then((d) => alive && setTargetFields(d.fields))
      .catch((e) => alive && setError(errorMessage(e)))
    return () => {
      alive = false
    }
  }, [target])

  useEffect(() => {
    if (!targetFields) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      setLoading(true)
      const params = new URLSearchParams({ q: q.trim(), pageSize: '10', sort: 'updatedAt', dir: 'desc' })
      api<{ records: RecordDTO[] }>(`/api/objects/${encodeURIComponent(target)}/records?${params}`, { signal: ctrl.signal })
        .then((d) => {
          setError(null)
          setResults(
            d.records.map((r) => {
              const t = recordTitle(targetFields, r.values, r.id)
              primeTitle(r.id, t)
              return { id: r.id, title: t }
            }),
          )
        })
        .catch((e) => !ctrl.signal.aborted && setError(errorMessage(e)))
        .finally(() => !ctrl.signal.aborted && setLoading(false))
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q, target, targetFields])

  if (!target) return <p className="text-sm text-muted-foreground">This link field has no target object.</p>
  const choices = results.filter((r) => !ids.includes(r.id))

  return (
    <div className="space-y-2">
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ids.map((rid) => (
            <Badge key={rid} variant="secondary" className="gap-1 pr-1">
              <span className="max-w-[12rem] truncate">{title(rid)}</span>
              <button
                type="button"
                aria-label={`Remove ${title(rid)}`}
                className="rounded p-0.5 hover:bg-muted"
                onClick={() => onChange(ids.filter((x) => x !== rid))}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          id={id}
          placeholder="Search records to link…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} // don't submit the surrounding form
        />
        {loading && <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {choices.length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded-md border text-sm">
          {choices.map((r) => (
            <li key={r.id}>
              <button type="button" className="w-full truncate px-3 py-1.5 text-left hover:bg-muted" onClick={() => onChange([...ids, r.id])}>
                {r.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
