'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { usePipelineConfig } from '@/lib/hooks/usePipelineConfig'

interface IssueLead {
  id: string
  company: { name: string } | null
  person: { name: string } | null
}

interface Issue {
  id: string
  row: number
  kind: 'skip' | 'stage_unmapped'
  reason: string
  rawValue: string | null
  leadId: string | null
  lead: IssueLead | null
  suggestedStage: string | null
  suggestionConfidence: string | null
  resolvedAt: string | null
}

export function SyncReviewPanel({ jobRunId }: { jobRunId: string }) {
  const { stages } = usePipelineConfig()
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [resolving, setResolving] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      const res = await fetch(`/api/jobs/${jobRunId}/issues`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not load issues')
        return
      }
      setIssues(data.issues)
      setSelections((prev) => {
        const next = { ...prev }
        for (const issue of data.issues as Issue[]) {
          if (issue.suggestedStage && next[issue.id] === undefined) {
            next[issue.id] = issue.suggestedStage
          }
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobRunId])

  async function resolve(issue: Issue) {
    setResolving(issue.id)
    try {
      const body = issue.kind === 'stage_unmapped' ? { stage: selections[issue.id] } : {}
      const res = await fetch(`/api/jobs/${jobRunId}/issues/${issue.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not resolve issue')
        return
      }
      setIssues((prev) => (prev ? prev.filter((i) => i.id !== issue.id) : prev))
      if (data.stageUnchanged) setError(`That lead had already moved to "${data.currentStage}", so its stage was left as is.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setResolving(null)
    }
  }

  // A failed first load would otherwise spin forever: show why, and retry.
  if (issues === null && error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-sm">
        <p role="alert" className="text-destructive">{error}</p>
        <Button size="sm" variant="outline" onClick={load}>Try again</Button>
      </div>
    )
  }

  if (issues === null) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const skips = issues.filter((i) => i.kind === 'skip')
  const stageUnmapped = issues.filter((i) => i.kind === 'stage_unmapped')

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
        Nothing left to review for this run.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {stageUnmapped.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Unmapped stage values
              <Badge variant="secondary" className="ml-2">{stageUnmapped.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stageUnmapped.map((issue) => (
              <div key={issue.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-medium truncate">
                    Row {issue.row} — {issue.lead?.company?.name ?? 'Unknown company'}
                    {issue.lead?.person?.name ? ` (${issue.lead.person.name})` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Sheet value: <span className="font-mono">{issue.rawValue}</span>
                    {issue.suggestionConfidence && (
                      <span className="ml-2 italic">AI: {issue.suggestionConfidence}</span>
                    )}
                  </p>
                </div>
                <Select
                  value={selections[issue.id] ?? ''}
                  onValueChange={(v) => setSelections((prev) => ({ ...prev, [issue.id]: v }))}
                >
                  <SelectTrigger className="h-8 w-40 text-xs">
                    <SelectValue placeholder="Choose stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!selections[issue.id] || resolving === issue.id}
                  onClick={() => resolve(issue)}
                >
                  {resolving === issue.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply'}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {skips.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Skipped rows
              <Badge variant="secondary" className="ml-2">{skips.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {skips.map((issue) => (
              <div key={issue.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  Row {issue.row}: {issue.reason}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resolving === issue.id}
                  onClick={() => resolve(issue)}
                >
                  {resolving === issue.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Acknowledge'}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
