'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Upload, Loader2, CheckCircle2 } from 'lucide-react'
import { FIELDS, FIELD_LABELS, autoMapHeaders, autoMapCustomFields, type Field } from '@/lib/headerMapping'
import { useLeadFieldDefinitions } from '@/lib/hooks/usePipelineConfig'

// Client-side only: the file is parsed in the browser (via xlsx/SheetJS) and
// never uploaded raw — only the already-mapped row objects are sent to the
// server. Keeps this internal upload's blast radius inside the uploader's own tab.

const NONE = '__none__'

interface ParsedFile {
  headers: string[]
  rows: Record<string, unknown>[]
}

interface ImportResult {
  created: number
  skipped: { row: number; reason: string }[]
  customFieldWarnings: { row: number; reason: string }[]
}

export function ImportLeadsDialog() {
  const router = useRouter()
  const { fields: customFieldDefs } = useLeadFieldDefinitions()
  const [open, setOpen] = useState(false)
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [mapping, setMapping] = useState<Record<Field, string | null> | null>(null)
  // Leftover columns matched against the org's own admin-defined custom
  // fields (Settings -> Pipeline -> Custom fields) — e.g. a "Location"
  // column lands here instead of being silently dropped, as long as a
  // custom field with a matching label/key already exists.
  const [customFieldMapping, setCustomFieldMapping] = useState<Record<string, string | null> | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  function reset() {
    setParsed(null)
    setMapping(null)
    setCustomFieldMapping(null)
    setParseError(null)
    setResult(null)
  }

  async function handleFile(file: File) {
    reset()
    try {
      const buf = await file.arrayBuffer()
      const workbook = XLSX.read(buf, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      if (rows.length === 0) {
        setParseError('No rows found in that file.')
        return
      }
      const headers = Object.keys(rows[0])
      setParsed({ headers, rows })
      const claimed = new Set<number>()
      setMapping(autoMapHeaders(headers, claimed))
      setCustomFieldMapping(autoMapCustomFields(headers, customFieldDefs, claimed))
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }

  function mappedRows() {
    if (!parsed || !mapping) return []
    return parsed.rows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const field of FIELDS) {
        const header = mapping[field]
        out[field] = header ? row[header] : ''
      }
      if (customFieldMapping) {
        const customFields: Record<string, unknown> = {}
        for (const def of customFieldDefs) {
          const header = customFieldMapping[def.key]
          if (!header) continue
          const raw = row[header]
          if (raw === '' || raw == null) continue
          customFields[def.key] = def.type === 'number' ? Number(raw) : String(raw)
        }
        if (Object.keys(customFields).length > 0) out.customFields = customFields
      }
      return out
    })
  }

  const missingRequired = parsed && mapping
    ? mappedRows().filter((r) => !r.company).length
    : 0

  async function handleImport() {
    setImporting(true)
    try {
      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: mappedRows() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setParseError(data.error ?? 'Import failed')
        return
      }
      setResult(data)
      router.refresh()
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  const preview = parsed ? mappedRows().slice(0, 5) : []

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="h-4 w-4" />
          Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import leads from CSV or Excel</DialogTitle>
          <DialogDescription>
            Upload a .csv or .xlsx file. We&apos;ll try to match columns automatically — check the mapping before
            importing.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              Imported {result.created} lead{result.created === 1 ? '' : 's'}.
            </div>
            {result.skipped.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border p-2 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">{result.skipped.length} row(s) skipped:</p>
                {result.skipped.map((s) => (
                  <p key={s.row}>
                    Row {s.row}: {s.reason}
                  </p>
                ))}
              </div>
            )}
            {result.customFieldWarnings.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border p-2 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">
                  {result.customFieldWarnings.length} lead(s) created without their custom field value:
                </p>
                {result.customFieldWarnings.map((s, i) => (
                  <p key={i}>
                    Row {s.row}: {s.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : !parsed ? (
          <div className="space-y-2">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
              }}
              className="block w-full text-sm rounded-md border p-2"
            />
            {parseError && <p className="text-xs text-rose-600">{parseError}</p>}
          </div>
        ) : (
          <div className="space-y-4 min-w-0">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {FIELDS.map((field) => (
                <div key={field} className="space-y-1 min-w-0">
                  <label className="text-xs font-medium text-muted-foreground">
                    {FIELD_LABELS[field]}
                    {field === 'company' && <span className="text-rose-500"> *</span>}
                  </label>
                  <Select
                    value={mapping?.[field] ?? NONE}
                    onValueChange={(v) => setMapping((m) => (m ? { ...m, [field]: v === NONE ? null : v } : m))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— none —</SelectItem>
                      {parsed.headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {customFieldDefs.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Custom fields</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {customFieldDefs.map((def) => (
                    <div key={def.key} className="space-y-1 min-w-0">
                      <label className="text-xs font-medium text-muted-foreground">{def.label}</label>
                      <Select
                        value={customFieldMapping?.[def.key] ?? NONE}
                        onValueChange={(v) =>
                          setCustomFieldMapping((m) => (m ? { ...m, [def.key]: v === NONE ? null : v } : m))
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>— none —</SelectItem>
                          {parsed.headers.map((h) => (
                            <SelectItem key={h} value={h}>
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs font-medium">
                Preview — {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} parsed
                {missingRequired > 0 && (
                  <span className="text-amber-600"> · {missingRequired} missing company will be skipped</span>
                )}
              </p>
              <div className="max-h-52 min-w-0 overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {FIELDS.map((f) => (
                        <th key={f} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                          {FIELD_LABELS[f]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t">
                        {FIELDS.map((f) => (
                          <td key={f} className="px-2 py-1.5 truncate max-w-[140px]">
                            {String(row[f] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {parseError && <p className="text-xs text-rose-600">{parseError}</p>}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              {parsed && (
                <Button onClick={handleImport} disabled={importing || !mapping?.company}>
                  {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Import {parsed.rows.length} lead{parsed.rows.length === 1 ? '' : 's'}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
