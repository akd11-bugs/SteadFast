'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FIELD_TYPES, type FieldConfig, type FieldOption, type FieldType } from '@/lib/records/fieldTypes'
import { api, errorMessage, newOptionKey, OPTION_TYPES, TYPE_LABELS, toFieldDTO, type FieldDTO, type ObjectTypeDTO } from '@/lib/records/client'
import { NameInput } from './ObjectsEditor'

const DEFAULT_COLORS = ['#64748b', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7']

function newOption(i: number): FieldOption {
  return { key: newOptionKey(), label: '', color: DEFAULT_COLORS[i % DEFAULT_COLORS.length] }
}

export function FieldsEditor({
  object,
  fields,
  onFieldsChange,
  objects,
  onError,
}: {
  object: ObjectTypeDTO
  fields: FieldDTO[]
  onFieldsChange: (f: FieldDTO[]) => void
  objects: ObjectTypeDTO[]
  onError: (msg: string | null) => void
}) {
  // Optimistic update. On success a returned list (the server's version) replaces it;
  // on failure `recover` (default: the previous list) does.
  async function apply(next: FieldDTO[], requests: () => Promise<FieldDTO[] | void>, recover?: () => Promise<FieldDTO[]>) {
    const before = fields
    onError(null)
    onFieldsChange(next)
    try {
      const result = await requests()
      if (result) onFieldsChange(result)
      return true
    } catch (e) {
      onError(errorMessage(e))
      onFieldsChange(recover ? await recover().catch(() => before) : before)
      return false
    }
  }

  type FieldRow = Parameters<typeof toFieldDTO>[0]
  const patch = (f: FieldDTO, change: Partial<Pick<FieldDTO, 'label' | 'config' | 'required'>>) => {
    const next = fields.map((x) => (x.id === f.id ? { ...x, ...change } : x))
    // The server normalises config, so keep what it stored rather than what we sent.
    return apply(next, async () => {
      const { field } = await api<{ field: FieldRow }>(`/api/fields/${f.id}`, { method: 'PATCH', body: change })
      return next.map((x) => (x.id === f.id ? toFieldDTO(field) : x))
    })
  }

  function move(i: number, dir: -1 | 1) {
    const order = [...fields]
    ;[order[i], order[i + dir]] = [order[i + dir], order[i]]
    const changed = order.flatMap((f, idx) => (f.position === idx ? [] : [{ ...f, position: idx }]))
    const next = order.map((f, idx) => ({ ...f, position: idx }))
    void apply(
      next,
      async () => void (await Promise.all(changed.map((f) => api(`/api/fields/${f.id}`, { method: 'PATCH', body: { position: f.position } })))),
      // Some PATCHes may have landed; the old list could be just as wrong, so ask the server.
      () => api<{ fields: FieldRow[] }>(`/api/objects/${object.id}/fields`).then((d) => d.fields.map(toFieldDTO)),
    )
  }

  async function remove(f: FieldDTO) {
    if (!confirm(`Delete the field "${f.label}"? This permanently deletes this field's value on every record. This cannot be undone.`)) return
    void apply(
      fields.filter((x) => x.id !== f.id),
      async () => void (await api(`/api/fields/${f.id}`, { method: 'DELETE' })),
    )
  }

  return (
    <div className="space-y-3">
      {fields.length === 0 && <p className="text-sm text-muted-foreground">No fields yet.</p>}
      <ul className="space-y-2">
        {fields.map((f, i) => (
          <li key={f.id} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <NameInput key={f.label} value={f.label} label="Field label" className="h-8 min-w-[10rem] flex-1" onSave={(label) => patch(f, { label })} />
              <span className="text-xs text-muted-foreground">
                {TYPE_LABELS[f.type] ?? f.type}
                {f.type === 'link' && ` → ${objects.find((o) => o.id === f.config.targetObjectTypeId)?.name ?? 'missing object'}`}
              </span>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={f.required} onChange={(e) => patch(f, { required: e.target.checked })} />
                Required
              </label>
              <div className="ml-auto flex items-center">
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={`Move ${f.label} down`}
                  disabled={i === fields.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  aria-label={`Delete ${f.label}`}
                  onClick={() => remove(f)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {OPTION_TYPES.has(f.type) && (
              <SavedOptions key={JSON.stringify(f.config.options)} field={f} onSave={(options) => patch(f, { config: { options } })} />
            )}
            {f.type === 'currency' && (
              <CurrencyInput
                key={f.config.currency}
                id={`cur-${f.id}`}
                value={f.config.currency ?? 'INR'}
                onSave={(currency) => patch(f, { config: { currency } })}
              />
            )}
          </li>
        ))}
      </ul>
      <AddField object={object} objects={objects} onAdded={(f) => onFieldsChange([...fields, f])} onError={onError} />
    </div>
  )
}

function CurrencyInput({ id, value, onSave }: { id: string; value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-xs">
        Currency code
      </Label>
      <Input
        id={id}
        className="h-8 w-24 uppercase"
        maxLength={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onBlur={() => draft !== value && onSave(draft)}
      />
    </div>
  )
}

// Options of an existing field: edited locally, saved together (the server
// refuses removing an option still in use, and that error is shown).
function SavedOptions({ field, onSave }: { field: FieldDTO; onSave: (o: FieldOption[]) => Promise<boolean> }) {
  const initial = field.config.options ?? []
  const [options, setOptions] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(options) !== JSON.stringify(initial)
  return (
    <div className="space-y-2 rounded-md bg-muted/50 p-2">
      <OptionsEditor type={field.type} options={options} onChange={setOptions} idPrefix={field.id} />
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOptions(initial)} disabled={saving}>
            Reset
          </Button>
          <Button
            size="sm"
            disabled={saving || options.some((o) => !o.label.trim())}
            onClick={async () => {
              setSaving(true)
              await onSave(options.map((o) => ({ ...o, label: o.label.trim() })))
              setSaving(false)
            }}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save options
          </Button>
        </div>
      )}
    </div>
  )
}

function OptionsEditor({
  type,
  options,
  onChange,
  idPrefix,
}: {
  type: FieldType
  options: FieldOption[]
  onChange: (o: FieldOption[]) => void
  idPrefix: string
}) {
  const set = (i: number, change: Partial<FieldOption>) => onChange(options.map((o, j) => (j === i ? { ...o, ...change } : o)))
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{type === 'status' ? 'Stages' : 'Options'}</p>
      {options.map((o, i) => (
        <div key={o.key} className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label={`Colour of ${o.label || 'option'}`}
            className="h-8 w-8 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
            value={o.color ?? '#64748b'}
            onChange={(e) => set(i, { color: e.target.value })}
          />
          <Input
            id={`${idPrefix}-opt-${o.key}`}
            aria-label="Option label"
            className="h-8 min-w-[8rem] flex-1"
            placeholder="Label"
            value={o.label}
            onChange={(e) => set(i, { label: e.target.value })}
          />
          {type === 'status' && (
            <>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={!!o.isWon}
                  onChange={(e) => set(i, { isWon: e.target.checked || undefined, ...(e.target.checked ? { isLost: undefined } : {}) })}
                />
                Won
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={!!o.isLost}
                  onChange={(e) => set(i, { isLost: e.target.checked || undefined, ...(e.target.checked ? { isWon: undefined } : {}) })}
                />
                Lost
              </label>
            </>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={`Remove option ${o.label}`}
            onClick={() => onChange(options.filter((_, j) => j !== i))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...options, newOption(options.length)])}>
        <Plus className="h-3.5 w-3.5" />
        Add {type === 'status' ? 'stage' : 'option'}
      </Button>
    </div>
  )
}

function AddField({
  object,
  objects,
  onAdded,
  onError,
}: {
  object: ObjectTypeDTO
  objects: ObjectTypeDTO[]
  onAdded: (f: FieldDTO) => void
  onError: (msg: string | null) => void
}) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const [required, setRequired] = useState(false)
  const [options, setOptions] = useState<FieldOption[]>([newOption(0)])
  const [currency, setCurrency] = useState('INR')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const p = `add-${object.id}`

  const hasOptions = OPTION_TYPES.has(type)
  const invalid =
    !label.trim() ||
    (hasOptions && (options.length === 0 || options.some((o) => !o.label.trim()))) ||
    (type === 'link' && !target)

  async function add() {
    if (invalid) return
    const config: FieldConfig = hasOptions
      ? { options: options.map((o) => ({ ...o, label: o.label.trim() })) }
      : type === 'currency'
        ? { currency }
        : type === 'link'
          ? { targetObjectTypeId: target }
          : {}
    setBusy(true)
    onError(null)
    try {
      const { field } = await api<{ field: FieldDTO }>(`/api/objects/${object.id}/fields`, {
        method: 'POST',
        body: { label: label.trim(), type, config, required },
      })
      onAdded(field)
      setLabel('')
      setRequired(false)
      setOptions([newOption(0)])
    } catch (e) {
      onError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Plus className="h-3.5 w-3.5" /> Add a field
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${p}-label`} className="text-xs">
            Label
          </Label>
          <Input id={`${p}-label`} className="h-8" value={label} placeholder="e.g. Order value" onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${p}-type`} className="text-xs">
            Type
          </Label>
          <Select value={type} onValueChange={(v) => setType(v as FieldType)}>
            <SelectTrigger id={`${p}-type`} className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {hasOptions && <OptionsEditor type={type} options={options} onChange={setOptions} idPrefix={p} />}
      {type === 'currency' && (
        <div className="flex items-center gap-2">
          <Label htmlFor={`${p}-cur`} className="text-xs">
            Currency code
          </Label>
          <Input id={`${p}-cur`} className="h-8 w-24 uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </div>
      )}
      {type === 'link' && (
        <div className="space-y-1">
          <Label htmlFor={`${p}-target`} className="text-xs">
            Links to
          </Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger id={`${p}-target`} className="h-8">
              <SelectValue placeholder="Choose an object" />
            </SelectTrigger>
            <SelectContent>
              {objects.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required
        </label>
        <Button size="sm" onClick={add} disabled={busy || invalid}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Add field
        </Button>
      </div>
    </div>
  )
}
