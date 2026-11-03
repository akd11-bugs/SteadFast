'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Wand2, Loader2, ScanLine, X } from 'lucide-react'
import { extractLeadFields, extractLinks } from '@/lib/aiExtraction'
import { decodeCardQr } from '@/lib/cardScan/decodeQr'
import { WebcamCapture } from './WebcamCapture'
import {
  SOURCES,
  SOURCE_LABELS,
  LEAD_TYPES,
  LEAD_TYPE_LABELS,
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  type LeadSource,
  type LeadType,
  type BusinessType,
} from '@/lib/types'
import { usePipelineConfig, useLeadFieldDefinitions } from '@/lib/hooks/usePipelineConfig'
import { CustomFieldsSection } from './CustomFieldsSection'
import { CompanyPicker } from './CompanyPicker'
import { TasksToCreateField, type DraftTask } from './TasksToCreateField'

const NONE = '__none__'

// Normally an uncontrolled dialog (its own trigger button + internal open
// state) — the command palette's "Create lead" action instead opens it
// headlessly via `open`/`onOpenChange`, with no trigger rendered at all.
export function NewLeadDialog({
  children,
  open: openProp,
  onOpenChange,
}: {
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [saving, setSaving] = useState(false)
  const [duplicateError, setDuplicateError] = useState<string | null>(null)
  const { stages } = usePipelineConfig()
  const { fields: customFieldDefs } = useLeadFieldDefinitions()
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({})
  const [tasks, setTasks] = useState<DraftTask[]>([])
  const [pasteText, setPasteText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [form, setForm] = useState({
    poc: '',
    company: '',
    email: '',
    phone: '',
    website: '',
    industry: '',
    businessType: '' as BusinessType | '',
    source: 'website' as LeadSource,
    stage: 'new',
    type: 'merchant' as LeadType,
    estimatedVolume: '5000',
    notes: '',
    linkedinUrl: '',
    otherLinks: [] as string[],
  })

  // Runs entirely in the browser (lib/aiExtraction.ts) — a small NER model
  // plus regex, not an LLM call. Only fills fields the user hasn't already
  // typed something into, so re-running extraction (or pasting a second
  // blob) never clobbers a manual edit.
  async function handleExtract() {
    if (!pasteText.trim()) return
    setExtracting(true)
    try {
      const extracted = await extractLeadFields(pasteText)
      setForm((prev) => ({
        ...prev,
        // extracted.x comes first: when prev.x is '' (falsy) and
        // extracted.x is undefined, "prev.x || extracted.x" would evaluate
        // to undefined, not '' — breaking these fields' string type. Only
        // "extracted.x || prev.x" is safe in both directions.
        company: extracted.company || prev.company,
        poc: extracted.poc || prev.poc,
        email: extracted.email || prev.email,
        phone: extracted.phone || prev.phone,
      }))
    } finally {
      setExtracting(false)
    }
  }

  // Scan path: QR/barcode decoding happens on-device first (lib/cardScan/
  // decodeQr.ts — instant, no network call), then the photo goes to
  // Cloud Vision OCR server-side (/api/leads/scan-card) for the printed
  // text. That route also runs the OCR text through Cloud Natural
  // Language's entity extraction server-side (lib/cardScan/
  // entityExtraction.ts) — the on-device NER model (used below as a
  // fallback, and still what the paste-text flow above uses) is noticeably
  // weaker on short, fragmented card text than a full sentence, so prefer
  // Google's company/POC result when the server provided one. extractLinks()
  // still runs client-side either way — no server equivalent needed for
  // pure regex URL matching. Every result merges into form state the same
  // "only fill empty fields" way handleExtract already does — this is a
  // second way to trigger the same merge-fill behavior, not a parallel/
  // competing code path. Never auto-submits: the rep still reviews every
  // field before saving.
  async function handleScanCard(file: File) {
    setScanning(true)
    setScanError(null)
    try {
      const qr = await decodeCardQr(file)

      let ocrText = ''
      let serverEntities: { company?: string; poc?: string } = {}
      try {
        const res = await fetch('/api/leads/scan-card', {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'image/jpeg' },
          body: file,
        })
        if (res.ok) {
          const data = await res.json()
          ocrText = data.text ?? ''
          serverEntities = data.entities ?? {}
        } else if (!qr) {
          // Only surface the OCR failure if the QR path also found nothing
          // — a card with a working QR code still fills useful fields even
          // when the OCR call itself failed (rate limit, network, etc.).
          const data = await res.json().catch(() => null)
          setScanError(data?.error ?? 'Could not read that card.')
        }
      } catch {
        if (!qr) setScanError('Could not reach the server to read that card.')
      }

      const extracted = ocrText ? await extractLeadFields(ocrText) : {}
      const links = ocrText ? extractLinks(ocrText) : { other: [] }

      setForm((prev) => ({
        ...prev,
        company: qr?.vcard?.company || serverEntities.company || extracted.company || prev.company,
        poc: qr?.vcard?.name || serverEntities.poc || extracted.poc || prev.poc,
        email: qr?.vcard?.email || extracted.email || prev.email,
        phone: qr?.vcard?.phone || extracted.phone || prev.phone,
        linkedinUrl: links.linkedin || prev.linkedinUrl,
        otherLinks: [
          ...prev.otherLinks,
          ...[qr?.vcard?.url, qr?.url, ...links.other].filter(
            (l): l is string => !!l && !prev.otherLinks.includes(l),
          ),
        ],
      }))

      if (!qr && !ocrText) {
        setScanError('No text or QR code found on that photo. Try a clearer shot, or fill the fields in manually.')
      }
    } finally {
      setScanning(false)
    }
  }

  async function handleSubmit(force = false) {
    if (!form.company || !form.email) return
    setSaving(true)
    setDuplicateError(null)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          businessType: form.businessType || null,
          estimatedVolume: Number(form.estimatedVolume),
          customFields,
          force,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const tasksToCreate = tasks.filter((t) => t.title.trim())
        if (tasksToCreate.length > 0) {
          // Best-effort — the lead is already saved; a failed task shouldn't
          // undo it or block closing the dialog.
          await Promise.all(
            tasksToCreate.map((t) =>
              fetch('/api/tasks', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ leadId: data.lead.id, title: t.title.trim(), dueDate: t.dueDate || null }),
              }).catch(() => {})
            )
          )
        }
        setOpen(false)
        setForm({
          poc: '',
          company: '',
          email: '',
          phone: '',
          website: '',
          industry: '',
          businessType: '',
          source: 'website',
          stage: 'new',
          type: 'merchant',
          estimatedVolume: '5000',
          notes: '',
          linkedinUrl: '',
          otherLinks: [],
        })
        setCustomFields({})
        setTasks([])
        setPasteText('')
        setScanError(null)
        router.refresh()
        return
      }
      if (res.status === 409) {
        const data = await res.json()
        setDuplicateError(data.error)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setDuplicateError(null)
      }}
    >
      {openProp === undefined && (
        <DialogTrigger asChild>
          {children ?? (
            <Button size="sm">
              <Plus className="h-4 w-4" />
              New Lead
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a new lead</DialogTitle>
          <DialogDescription>Capture details now. Follow up later — that's what the skills are for.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5 rounded-md border border-dashed p-2.5">
            <Label htmlFor="pasteText" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wand2 className="h-3.5 w-3.5" />
              Paste a message, signature, or note to auto-fill the fields below
            </Label>
            <div className="flex gap-2">
              <Textarea
                id="pasteText"
                rows={2}
                className="text-sm"
                placeholder="e.g. Hey, this is Priya from Northwind Traders, reach me at priya@northwind.com or 555-0142…"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <Button type="button" size="sm" variant="outline" className="self-start shrink-0" onClick={handleExtract} disabled={extracting || !pasteText.trim()}>
                {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                Fill
              </Button>
            </div>
          </div>
          {/* Phone/tablet only — no user-agent sniffing (none exists
              anywhere in this codebase), just the same CSS-breakpoint
              visibility pattern already used site-wide (TopBar.tsx,
              Sidebar.tsx). Desktop simply never sees this entry point;
              nothing breaks if a desktop browser reached it directly. */}
          <div className="space-y-1.5 rounded-md border border-dashed p-2.5 md:hidden">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ScanLine className="h-3.5 w-3.5" />
              Scan a business card to auto-fill the fields below
            </Label>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={scanning} asChild>
                <label className="cursor-pointer">
                  {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
                  {scanning ? 'Reading card…' : 'Scan card'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    disabled={scanning}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) handleScanCard(file)
                    }}
                  />
                </label>
              </Button>
              {scanError && <p className="text-xs text-destructive">{scanError}</p>}
            </div>
          </div>
          {/* Desktop counterpart — mobile's capture="environment" delegates
              to the OS camera app, which has no equivalent on desktop
              browsers (they just show a file picker), so this opens an
              in-page getUserMedia() live preview instead. Both feed the
              exact same handleScanCard/OCR/QR pipeline. */}
          <div className="hidden space-y-1.5 rounded-md border border-dashed p-2.5 md:block">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ScanLine className="h-3.5 w-3.5" />
              Scan a business card with your webcam to auto-fill the fields below
            </Label>
            <WebcamCapture disabled={scanning} onCapture={handleScanCard} />
            {scanError && <p className="text-xs text-destructive">{scanError}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="company">Company</Label>
              <CompanyPicker id="company" value={form.company} onChange={(name) => setForm({ ...form, company: name })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="poc">POC (optional)</Label>
              <Input id="poc" value={form.poc} onChange={(e) => setForm({ ...form, poc: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="website">Website (optional)</Label>
              <Input
                id="website"
                placeholder="https://…"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="industry">Industry (optional)</Label>
              <Input
                id="industry"
                placeholder="Fashion, Apparel, F&B…"
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
              />
            </div>
          </div>
          {/* Only shown once there's something to show — a manually-entered
              lead never needs these; a scanned card usually fills one or
              both. */}
          {(form.linkedinUrl || form.otherLinks.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="linkedinUrl">LinkedIn (optional)</Label>
                <Input
                  id="linkedinUrl"
                  placeholder="https://linkedin.com/in/…"
                  value={form.linkedinUrl}
                  onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Other links</Label>
                <div className="flex flex-wrap gap-1.5 rounded-md border border-input px-2 py-1.5">
                  {form.otherLinks.length === 0 && <span className="text-xs text-muted-foreground">None found</span>}
                  {form.otherLinks.map((link) => (
                    <span key={link} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                      {link}
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, otherLinks: form.otherLinks.filter((l) => l !== link) })}
                        aria-label={`Remove ${link}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Business type</Label>
              <Select
                value={form.businessType || NONE}
                onValueChange={(v) => setForm({ ...form, businessType: v === NONE ? '' : (v as BusinessType) })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {BUSINESS_TYPES.map((b) => (
                    <SelectItem key={b} value={b}>{BUSINESS_TYPE_LABELS[b]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v as LeadSource })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{SOURCE_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as LeadType })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{LEAD_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Stage</Label>
              <Select value={form.stage} onValueChange={(v) => setForm({ ...form, stage: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="estimatedVolume">Est. Volume (₹)</Label>
            <Input
              id="estimatedVolume"
              type="number"
              value={form.estimatedVolume}
              onChange={(e) => setForm({ ...form, estimatedVolume: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <CustomFieldsSection
            fields={customFieldDefs}
            values={customFields}
            onChange={(key, value) => setCustomFields((prev) => ({ ...prev, [key]: value }))}
          />
          <TasksToCreateField tasks={tasks} onChange={setTasks} />
        </div>
        {duplicateError && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {duplicateError}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {duplicateError ? (
            <Button variant="outline" onClick={() => handleSubmit(true)} disabled={saving}>
              {saving ? 'Creating…' : 'Create anyway'}
            </Button>
          ) : (
            <Button onClick={() => handleSubmit(false)} disabled={saving || !form.company || !form.email}>
              {saving ? 'Saving…' : 'Create lead'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
