'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage, type FieldDTO, type ObjectTypeDTO } from '@/lib/records/client'
import { FieldsEditor } from './FieldsEditor'

interface ObjectWithFields extends ObjectTypeDTO {
  fields: FieldDTO[]
}

export function ObjectsEditor({ initialObjects }: { initialObjects: ObjectWithFields[] }) {
  const [objects, setObjects] = useState(initialObjects)
  const [open, setOpen] = useState<string | null>(initialObjects[0]?.id ?? null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const { object } = await api<{ object: ObjectTypeDTO }>('/api/objects', { method: 'POST', body: { name: name.trim() } })
      setObjects((prev) => [...prev, { ...object, fields: [] }])
      setOpen(object.id)
      setName('')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  // Optimistic patch; rolls back to the previous row if the server refuses.
  async function patch(id: string, change: Partial<Pick<ObjectTypeDTO, 'name' | 'restrictToOwner'>>) {
    const before = objects.find((o) => o.id === id)
    if (!before) return
    setError(null)
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, ...change } : o)))
    try {
      await api(`/api/objects/${id}`, { method: 'PATCH', body: change })
    } catch (e) {
      setObjects((prev) => prev.map((o) => (o.id === id ? before : o)))
      setError(errorMessage(e))
    }
  }

  async function remove(o: ObjectWithFields) {
    if (!confirm(`Delete "${o.name}" and its ${o.fields.length} field(s)? Objects that still have records can't be deleted.`)) return
    setError(null)
    try {
      await api(`/api/objects/${o.id}`, { method: 'DELETE' })
      setObjects((prev) => prev.filter((x) => x.id !== o.id))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const setFields = (id: string) => (fields: FieldDTO[]) => setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, fields } : o)))

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {objects.map((o) => (
        <Card key={o.id}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                aria-label={open === o.id ? `Collapse ${o.name}` : `Edit fields of ${o.name}`}
                aria-expanded={open === o.id}
                onClick={() => setOpen(open === o.id ? null : o.id)}
              >
                {open === o.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
              <CardTitle className="min-w-0 flex-1 text-base">
                <NameInput key={o.name} value={o.name} label="Object name" onSave={(v) => patch(o.id, { name: v })} />
              </CardTitle>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                aria-label={`Delete ${o.name}`}
                onClick={() => remove(o)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <label className="flex items-center gap-2 pl-10 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={o.restrictToOwner}
                onChange={(e) => patch(o.id, { restrictToOwner: e.target.checked })}
              />
              Members see only records they own
            </label>
          </CardHeader>
          {open === o.id && (
            <CardContent>
              <FieldsEditor object={o} fields={o.fields} onFieldsChange={setFields(o.id)} objects={objects} onError={setError} />
            </CardContent>
          )}
        </Card>
      ))}

      {objects.length === 0 && <p className="text-sm text-muted-foreground">No objects yet. Create one below, e.g. “Orders” or “Shipments”.</p>}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-6">
          <div className="min-w-[12rem] flex-1 space-y-1">
            <Label htmlFor="new-object-name">New object (plural name)</Label>
            <Input
              id="new-object-name"
              value={name}
              placeholder="e.g. Orders"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
          </div>
          <Button onClick={create} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create object
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// Saves on blur/Enter when the text changed; an empty name reverts.
export function NameInput({ value, label, onSave, className }: { value: string; label: string; onSave: (v: string) => void; className?: string }) {
  const [draft, setDraft] = useState(value)
  function commit() {
    const v = draft.trim()
    if (!v) setDraft(value)
    else if (v !== value) onSave(v)
  }
  return (
    <Input
      aria-label={label}
      className={className ?? 'h-8 font-semibold'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}
