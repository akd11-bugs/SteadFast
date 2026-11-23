'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import type { Value } from '@/lib/records/fieldTypes'
import { api, errorMessage, toDraft, toValue, type Draft, type FieldDTO, type PersonDTO, type RecordDTO } from '@/lib/records/client'
import { FieldInput } from './fields'

// Text-like inputs save on blur; the rest (selects, checkbox, links) on change.
const SAVE_ON_BLUR = new Set(['text', 'long_text', 'number', 'currency', 'email', 'phone', 'url', 'date'])

export function RecordDetail({
  recordId,
  listHref,
  fields,
  initialValues,
  people,
}: {
  recordId: string
  listHref: string
  fields: FieldDTO[]
  initialValues: { [key: string]: Value }
  people: PersonDTO[]
}) {
  const router = useRouter()
  const draftOf = (vals: { [key: string]: Value }) =>
    Object.fromEntries(fields.map((f) => [f.key, toDraft(f.type, vals[f.key])])) as { [key: string]: Draft }
  const saved = useRef(initialValues)
  const [drafts, setDrafts] = useState(() => draftOf(initialValues))
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Saves run one at a time so an older PATCH can't land after a newer one.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const latest = useRef(drafts) // the newest draft per field, readable inside queued saves

  async function save(f: FieldDTO, d: Draft) {
    const value = toValue(f.type, d)
    if (JSON.stringify(value) === JSON.stringify(saved.current[f.key] ?? null)) return
    setSaving(f.key)
    setError(null)
    try {
      const res = await api<{ record: RecordDTO }>(`/api/records/${recordId}`, {
        method: 'PATCH',
        body: { values: { [f.key]: value } },
      })
      // Keep what the server stored (it normalises, e.g. lower-cases emails), not what we sent.
      const stored = res.record.values[f.key] ?? null
      saved.current = { ...saved.current, [f.key]: stored }
      if (latest.current[f.key] === d) {
        const shown = toDraft(f.type, stored)
        latest.current = { ...latest.current, [f.key]: shown }
        setDrafts((prev) => ({ ...prev, [f.key]: shown }))
      }
      router.refresh() // title and "Updated" come from the server component
    } catch (e) {
      // Roll back to what the server still has, unless the user has since picked something newer.
      if (latest.current[f.key] === d) {
        const back = toDraft(f.type, saved.current[f.key])
        latest.current = { ...latest.current, [f.key]: back }
        setDrafts((prev) => ({ ...prev, [f.key]: back }))
      }
      setError(errorMessage(e))
    } finally {
      setSaving(null)
    }
  }

  function enqueue(f: FieldDTO, d: Draft) {
    queue.current = queue.current.then(() => save(f, d))
  }

  async function remove() {
    if (!confirm('Delete this record? This cannot be undone.')) return
    setDeleting(true)
    setError(null)
    try {
      await api(`/api/records/${recordId}`, { method: 'DELETE' })
      router.push(listHref)
    } catch (e) {
      setError(errorMessage(e))
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Card>
        <CardContent className="space-y-4 pt-6">
          {fields.length === 0 && <p className="text-sm text-muted-foreground">This object has no fields.</p>}
          {fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`f-${f.key}`} className="flex items-center gap-1.5">
                {f.label}
                {f.required && <span className="text-destructive">*</span>}
                {saving === f.key && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Saving" />}
              </Label>
              <FieldInput
                id={`f-${f.key}`}
                field={f}
                draft={drafts[f.key]}
                people={people}
                onChange={(d) => {
                  latest.current = { ...latest.current, [f.key]: d }
                  setDrafts((prev) => ({ ...prev, [f.key]: d }))
                  if (!SAVE_ON_BLUR.has(f.type)) enqueue(f, d)
                }}
                onBlur={SAVE_ON_BLUR.has(f.type) ? () => enqueue(f, drafts[f.key]) : undefined}
              />
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button variant="outline" className="text-destructive hover:text-destructive" onClick={remove} disabled={deleting}>
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Delete record
        </Button>
      </div>
    </div>
  )
}
