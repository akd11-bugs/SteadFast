'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Phone,
  Mail,
  Calendar,
  StickyNote,
  Sparkles,
  Loader2,
  ExternalLink,
  CheckCircle2,
  ClipboardCheck,
  ArrowRight,
} from 'lucide-react'
import { formatCurrency, formatDate, formatDateTime, formatRelative } from '@/lib/utils'
import {
  boardColumnFor,
  SOURCES,
  SOURCE_LABELS,
  QUALITY_LEVELS,
  QUALITY_LABELS,
  LEAD_TYPES,
  LEAD_TYPE_LABELS,
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  onboardingProgressPercent,
  type Lead,
  type Activity,
  type ActivityType,
  type BoardColumnKey,
  type LeadSource,
  type QualityLevel,
  type LeadType,
  type BusinessType,
} from '@/lib/types'
import { SKILLS } from '@/lib/skills/catalog'
import { EmailComposer } from './EmailComposer'
import { LeadTasksTab } from './LeadTasksTab'
import { StageChangeDialog } from './StageChangeDialog'
import { PipelineProgressBar } from './PipelineProgressBar'
import { CustomFieldsSection } from './CustomFieldsSection'
import { HighlightsGrid, type Highlight } from '@/components/shared/HighlightsGrid'
import { usePipelineConfig, useLeadFieldDefinitions } from '@/lib/hooks/usePipelineConfig'
import { suggestStage } from '@/lib/aiExtraction'
import { isSafeUrl } from '@/lib/types'

interface SkillRunEntry {
  id: string
  skillId: string
  skillName: string
  runnerType: string
  createdAt: string
}

interface CompanyDetail {
  id: string
  name: string
  website: string | null
  industry: string | null
  businessType: string | null
  people: { id: string; name: string; email: string | null; jobTitle: string | null }[]
  leads: { id: string; estimatedVolume: number; stage: string; person: { name: string } | null }[]
}

const ACTIVITY_ICONS: Record<ActivityType, React.ReactNode> = {
  call: <Phone className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  meeting: <Calendar className="h-3.5 w-3.5" />,
  note: <StickyNote className="h-3.5 w-3.5" />,
  onboarding_step: <ClipboardCheck className="h-3.5 w-3.5" />,
  stage_change: <ArrowRight className="h-3.5 w-3.5" />,
}

export interface LeadRecordHeaderContext {
  lead: Lead
  saving: boolean
  setActiveTab: (tab: string) => void
  deleteLead: () => void
}

/**
 * The shared "guts" of a lead record — everything below the title — used by
 * both the Kanban click-through modal (LeadDetailDialog) and the full
 * /leads/[id] page, so the two surfaces never again show a different layout
 * depending on where you opened the lead from. Each caller owns its own
 * shell (Dialog vs plain page) and supplies the header via a render prop,
 * since a Dialog's title/description must be Radix's own DialogTitle/
 * DialogDescription components (a11y-wired to the Dialog context) while a
 * full page just needs a plain heading — the content is identical either way.
 */
export function LeadRecordView({
  initialLead,
  onLeadChange,
  onDeleted,
  renderHeader,
}: {
  initialLead: Lead
  onLeadChange?: (lead: Lead) => void
  onDeleted?: () => void
  renderHeader: (ctx: LeadRecordHeaderContext) => React.ReactNode
}) {
  const router = useRouter()
  const [lead, setLead] = useState<Lead>(initialLead)
  const [activities, setActivities] = useState<Activity[]>(initialLead.activities ?? [])
  const [skillRuns, setSkillRuns] = useState<SkillRunEntry[]>((initialLead.skillRuns as SkillRunEntry[] | undefined) ?? [])
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  // One inline line for any failed action, so a failed save never looks like success.
  const [actionError, setActionError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [stageChangeTarget, setStageChangeTarget] = useState<{ key: BoardColumnKey; label: string } | null>(null)
  // A nudge, never an automatic change — suggestStage() just classifies the
  // note's text against this org's own board columns (small on-device
  // model, no LLM); the person still has to click to act on it.
  const [stageNudge, setStageNudge] = useState<{ key: string; label: string } | null>(null)
  const [activityForm, setActivityForm] = useState<{ type: ActivityType; description: string }>({
    type: 'note',
    description: '',
  })
  const { columns, onboardingSteps, pendingSubStatuses } = usePipelineConfig()
  const onboardingStepLabels = Object.fromEntries(onboardingSteps.map((s) => [s.key, s.label]))
  const { fields: customFieldDefs } = useLeadFieldDefinitions()
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>(() => {
    try {
      return initialLead.customFieldsJson ? JSON.parse(initialLead.customFieldsJson) : {}
    } catch {
      return {}
    }
  })
  const [companyDetail, setCompanyDetail] = useState<CompanyDetail | null>(null)

  useEffect(() => {
    if (activeTab !== 'company' || !lead.companyId) return
    fetch(`/api/companies/${lead.companyId}`)
      .then((r) => r.json())
      .then((data) => setCompanyDetail(data.company ?? null))
      .catch(() => setCompanyDetail(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, lead.companyId])

  async function failure(res: Response, what: string) {
    const body = await res.json().catch(() => null)
    setActionError(`${what} failed: ${body?.error ?? `server returned ${res.status}`}`)
  }

  // Returns whether the save landed, so callers can roll back optimistic state.
  async function patchLead(patch: Partial<Lead>): Promise<boolean> {
    setSaving(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        const data = await res.json()
        const updated = { ...lead, ...data.lead }
        setLead(updated)
        onLeadChange?.(updated)
        router.refresh()
        return true
      }
      await failure(res, 'Saving')
      return false
    } catch {
      setActionError('Saving failed: check your connection and try again.')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function patchCustomField(key: string, value: unknown) {
    const previous = customFieldValues[key]
    setCustomFieldValues((prev) => ({ ...prev, [key]: value }))
    const ok = await patchLead({ customFields: { [key]: value } } as unknown as Partial<Lead>)
    if (!ok) setCustomFieldValues((prev) => ({ ...prev, [key]: previous }))
  }

  async function addActivity() {
    if (!activityForm.description || posting) return
    const noteText = activityForm.description
    setPosting(true)
    setActionError(null)
    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, type: activityForm.type, description: noteText }),
      })
      if (!res.ok) return await failure(res, 'Logging the activity')
      setActivityForm({ type: 'note', description: '' })
      const refreshed = await fetch(`/api/leads/${lead.id}`).then((r) => r.json())
      setActivities(refreshed.lead?.activities ?? [])
      router.refresh()
      checkStageNudge(noteText)
    } catch {
      setActionError('Logging the activity failed: check your connection and try again.')
    } finally {
      setPosting(false)
    }
  }

  // Runs entirely in the browser (lib/aiExtraction.ts) — a small zero-shot
  // classification model, not an LLM call. Only ever offers a one-click
  // suggestion; never changes the stage itself.
  async function checkStageNudge(text: string) {
    if (text.trim().length < 12) return
    const current = boardColumnFor(lead)
    const candidates = columns.filter((c) => c.key !== current)
    if (!candidates.length) return
    try {
      const result = await suggestStage(text, candidates.map((c) => c.key), candidates.map((c) => c.label))
      if (result && result.confidence > 0.55) {
        const label = candidates.find((c) => c.key === result.stageKey)?.label ?? result.stageKey
        setStageNudge({ key: result.stageKey, label })
      }
    } catch {
      // model failed to load (offline, blocked) — silently skip the nudge, never block logging the note
    }
  }

  async function handleEmailSent() {
    const refreshed = await fetch(`/api/leads/${lead.id}`).then((r) => r.json())
    setActivities(refreshed.lead.activities ?? [])
    router.refresh()
  }

  async function deleteLead() {
    if (!confirm('Delete this lead? Activities and skill runs will be removed.')) return
    setActionError(null)
    const res = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' }).catch(() => null)
    if (!res) return setActionError('Deleting failed: check your connection and try again.')
    if (!res.ok) return failure(res, 'Deleting the lead')
    onDeleted?.()
    router.refresh()
  }

  async function runSkill(skillId: string, _skillName: string) {
    setRunning(skillId)
    setActionError(null)
    // Open the tab now, while the click still counts as a user gesture; the run
    // takes seconds and a window.open after the await gets popup-blocked.
    const tab = window.open('about:blank', '_blank')
    try {
      const res = await fetch('/api/skills/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillId, leadId: lead.id, scope: 'lead' }),
      })
      if (!res.ok) {
        tab?.close()
        return await failure(res, 'Running the skill')
      }
      const data = await res.json()
      if (data.runId) {
        const refreshed = await fetch(`/api/leads/${lead.id}`).then((r) => r.json())
        setSkillRuns(refreshed.lead?.skillRuns ?? [])
      }
      const url = `/skills/${skillId}?leadId=${lead.id}`
      if (tab) tab.location.href = url
      else window.location.href = url
    } catch {
      tab?.close()
      setActionError('Running the skill failed: check your connection and try again.')
    } finally {
      setRunning(null)
    }
  }

  const leadSkills = SKILLS.filter((s) => s.scope === 'lead')

  function handleStageChangeDone(updated: Lead) {
    const merged = { ...lead, ...updated }
    setLead(merged)
    onLeadChange?.(merged)
    router.refresh()
    fetch(`/api/leads/${updated.id}`)
      .then((r) => r.json())
      .then((data) => data.lead && setActivities(data.lead.activities ?? []))
  }

  const highlights: Highlight[] = [
    { label: 'Stage', value: columns.find((c) => c.key === boardColumnFor(lead))?.label ?? boardColumnFor(lead) },
    { label: 'Value', value: formatCurrency(lead.estimatedVolume) },
    { label: 'Owner', value: lead.ownerName },
    { label: 'Last activity', value: lead.lastActivityAt ? formatRelative(lead.lastActivityAt) : 'No activity yet' },
  ]

  return (
    <>
      {renderHeader({ lead, saving, setActiveTab, deleteLead })}
      {actionError && (
        <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{actionError}</span>
          <button type="button" className="shrink-0 underline" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <HighlightsGrid items={highlights} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activities">Activity ({activities.length})</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-2">
          <div className="rounded-md border p-3">
            <PipelineProgressBar
              stage={lead.stage}
              onboardingSubStage={lead.onboardingSubStage}
              assignedOpsName={lead.assignedOpsName}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Email">
              <Input
                type="email"
                defaultValue={lead.email}
                className="h-8"
                onBlur={(e) => {
                  if (e.target.value !== lead.email) patchLead({ email: e.target.value })
                }}
                disabled={saving}
              />
            </Field>
            <Field label="Phone">
              <Input
                type="tel"
                defaultValue={lead.phone ?? ''}
                className="h-8"
                placeholder="Phone number"
                onBlur={(e) => {
                  if (e.target.value !== (lead.phone ?? '')) patchLead({ phone: e.target.value || null })
                }}
                disabled={saving}
              />
            </Field>
            <Field label="POC (optional)">
              <Input
                defaultValue={lead.person?.name ?? ''}
                className="h-8"
                placeholder="Point of contact"
                onBlur={(e) => {
                  if (e.target.value !== (lead.person?.name ?? '')) patchLead({ poc: e.target.value || null } as unknown as Partial<Lead>)
                }}
                disabled={saving}
              />
            </Field>
            <Field label="Website">
              <Input
                defaultValue={lead.website ?? ''}
                className="h-8"
                placeholder="https://…"
                onBlur={(e) => {
                  if (e.target.value !== (lead.website ?? '')) patchLead({ website: e.target.value || null })
                }}
                disabled={saving}
              />
            </Field>
            <Field label="Industry">
              <Input
                defaultValue={lead.industry ?? ''}
                className="h-8"
                placeholder="Fashion, Apparel, F&B…"
                onBlur={(e) => {
                  if (e.target.value !== (lead.industry ?? '')) patchLead({ industry: e.target.value || null })
                }}
                disabled={saving}
              />
            </Field>
            {lead.person && (lead.person.linkedinUrl || JSON.parse(lead.person.otherLinksJson || '[]').length > 0) && (
              <>
                <Field label="LinkedIn">
                  {lead.person.linkedinUrl && isSafeUrl(lead.person.linkedinUrl) ? (
                    <a
                      href={lead.person.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block h-8 truncate text-sm leading-8 text-primary underline-offset-2 hover:underline"
                    >
                      {lead.person.linkedinUrl}
                    </a>
                  ) : lead.person.linkedinUrl ? (
                    <span className="block h-8 text-sm leading-8 text-destructive">Invalid link (not shown)</span>
                  ) : (
                    <span className="block h-8 text-sm leading-8 text-muted-foreground">Not set</span>
                  )}
                </Field>
                <Field label="Other links">
                  <div className="flex flex-wrap gap-1.5">
                    {(JSON.parse(lead.person.otherLinksJson || '[]') as string[])
                      .filter(isSafeUrl)
                      .map((link) => (
                        <a
                          key={link}
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate rounded bg-muted px-1.5 py-0.5 text-xs text-primary hover:underline"
                        >
                          {link}
                        </a>
                      ))}
                  </div>
                </Field>
              </>
            )}
            <Field label="Business type">
              <Select
                value={lead.businessType ?? 'unset'}
                onValueChange={(v) => patchLead({ businessType: v === 'unset' ? null : (v as BusinessType) })}
                disabled={saving}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Not set</SelectItem>
                  {BUSINESS_TYPES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {BUSINESS_TYPE_LABELS[b]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Stage">
              <Select
                value={boardColumnFor(lead)}
                onValueChange={(v) => {
                  if (v === boardColumnFor(lead)) return
                  const label = columns.find((c) => c.key === v)?.label ?? v
                  setStageChangeTarget({ key: v, label })
                }}
                disabled={saving}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Source">
              <Select value={lead.source} onValueChange={(v) => patchLead({ source: v as LeadSource })} disabled={saving}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SOURCE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {lead.intakeFormName && (
              <Field label="Via form">
                <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
                  {lead.intakeFormName}
                </Link>
              </Field>
            )}
            <Field label="Type">
              <Select value={lead.type} onValueChange={(v) => patchLead({ type: v as LeadType })} disabled={saving}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {LEAD_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Quality">
              <Select value={lead.quality} onValueChange={(v) => patchLead({ quality: v as QualityLevel })} disabled={saving}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_LEVELS.map((q) => (
                    <SelectItem key={q} value={q}>
                      {QUALITY_LABELS[q]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Effort">
              <Select value={lead.effort} onValueChange={(v) => patchLead({ effort: v as QualityLevel })} disabled={saving}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_LEVELS.map((q) => (
                    <SelectItem key={q} value={q}>
                      {QUALITY_LABELS[q]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Est. Volume (₹)">
              <Input
                type="number"
                defaultValue={lead.estimatedVolume}
                className="h-8"
                onBlur={(e) => {
                  const v = Number(e.target.value)
                  if (v !== lead.estimatedVolume) patchLead({ estimatedVolume: v })
                }}
                disabled={saving}
              />
            </Field>
            <Field label="Owner">
              {/* Read-only: free text drifted from the real owner. Admins reassign from the Leads list. */}
              <p className="h-8 flex items-center text-sm" title="Admins can reassign from the Leads list">
                {lead.ownerName}
              </p>
            </Field>
            <Field label="Expected close date">
              <Input
                type="date"
                defaultValue={lead.expectedCloseDate ? String(lead.expectedCloseDate).slice(0, 10) : ''}
                className="h-8"
                onBlur={(e) => {
                  patchLead({ expectedCloseDate: e.target.value ? new Date(e.target.value).toISOString() : null })
                }}
                disabled={saving}
              />
            </Field>
            <Field label="Onboarding">
              {lead.stage !== 'onboarding' ? (
                <span className="text-xs text-muted-foreground">
                  {lead.onboardedAt ? `Onboarded ${formatDate(lead.onboardedAt)}` : 'Starts once moved to Onboarding'}
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <Badge variant={lead.onboardingSubStage === 'final_onboarded' ? 'success' : 'outline'} className="gap-1">
                    {lead.onboardingSubStage === 'final_onboarded' && <CheckCircle2 className="h-3 w-3" />}
                    {lead.onboardingSubStage ? (onboardingStepLabels[lead.onboardingSubStage] ?? lead.onboardingSubStage) : 'Not started'}
                    {' · '}
                    {onboardingProgressPercent(lead.onboardingSubStage, onboardingSteps.map((s) => s.key))}%
                  </Badge>
                  <Link href={`/leads/${lead.id}/onboarding`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    Checklist <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Pain points</Label>
              <Textarea
                rows={3}
                placeholder="What's hurting them today?"
                defaultValue={lead.painPoints}
                onBlur={(e) => {
                  if (e.target.value !== lead.painPoints) patchLead({ painPoints: e.target.value })
                }}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label>What they want</Label>
              <Textarea
                rows={3}
                placeholder="What are they actually asking for?"
                defaultValue={lead.whatTheyWant}
                onBlur={(e) => {
                  if (e.target.value !== lead.whatTheyWant) patchLead({ whatTheyWant: e.target.value })
                }}
                disabled={saving}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              rows={4}
              defaultValue={lead.notes}
              onBlur={(e) => {
                if (e.target.value !== lead.notes) patchLead({ notes: e.target.value })
              }}
              disabled={saving}
            />
          </div>
          <CustomFieldsSection fields={customFieldDefs} values={customFieldValues} onChange={patchCustomField} disabled={saving} />
        </TabsContent>

        <TabsContent value="activities" className="pt-2 space-y-4">
          <EmailComposer
            key={lead.id}
            leadId={lead.id}
            leadEmail={lead.email}
            isNewStage={lead.stage === 'new'}
            onSent={handleEmailSent}
            onMarkContacted={() => {
              const defaultSubStatus = pendingSubStatuses.find((s) => s.isDefault) ?? pendingSubStatuses[0]
              if (defaultSubStatus) setStageChangeTarget({ key: defaultSubStatus.key, label: defaultSubStatus.label })
            }}
          />

          {stageNudge && (
            <div className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm dark:border-violet-900 dark:bg-violet-950">
              <Sparkles className="h-4 w-4 text-violet-500 shrink-0" />
              <span className="flex-1">That note sounds like it belongs in <b>{stageNudge.label}</b>.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setStageChangeTarget({ key: stageNudge.key, label: stageNudge.label })
                  setStageNudge(null)
                }}
              >
                Move it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStageNudge(null)}>
                Dismiss
              </Button>
            </div>
          )}

          <div className="rounded-md border p-3 space-y-2">
            <div className="flex gap-2">
              <Select value={activityForm.type} onValueChange={(v) => setActivityForm({ ...activityForm, type: v as ActivityType })}>
                <SelectTrigger className="h-9 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="note">Note</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="What happened? Discovery notes, call outcome, follow-up plan…"
              value={activityForm.description}
              onChange={(e) => setActivityForm({ ...activityForm, description: e.target.value })}
              rows={2}
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={addActivity} disabled={!activityForm.description || posting}>
                {posting ? 'Logging…' : 'Log activity'}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {activities.length === 0 && <p className="text-sm text-muted-foreground">No activity yet. Log one above.</p>}
            {activities.map((a) => (
              <div key={a.id} className="flex items-start gap-3 rounded-md border p-3">
                <div className="mt-0.5 text-muted-foreground">{ACTIVITY_ICONS[a.type]}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium capitalize">{a.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(a.date)} · {a.authorName}
                    </p>
                  </div>
                  <p className="text-sm whitespace-pre-line mt-0.5">{a.description}</p>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="pt-2">
          <LeadTasksTab leadId={lead.id} />
        </TabsContent>

        <TabsContent value="company" className="pt-2 space-y-4">
          {!companyDetail ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <a href={`/companies/${companyDetail.id}`} className="font-medium hover:underline">
                    {companyDetail.name}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {companyDetail.industry ?? 'Industry not set'}
                    {companyDetail.website && <> · {companyDetail.website}</>}
                  </p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/companies/${companyDetail.id}`}>Open company page</a>
                </Button>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  People at {companyDetail.name} ({companyDetail.people.length})
                </p>
                <div className="space-y-1.5">
                  {companyDetail.people.length === 0 && <p className="text-sm text-muted-foreground">No contacts identified yet.</p>}
                  {companyDetail.people.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.jobTitle ?? p.email ?? ''}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Other leads at this company ({Math.max(companyDetail.leads.length - 1, 0)})
                </p>
                <div className="space-y-1.5">
                  {companyDetail.leads.filter((l) => l.id !== lead.id).length === 0 && (
                    <p className="text-sm text-muted-foreground">This is the only lead at this company.</p>
                  )}
                  {companyDetail.leads
                    .filter((l) => l.id !== lead.id)
                    .map((l) => (
                      <a key={l.id} href={`/leads/${l.id}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
                        <span>{l.person?.name ?? 'No contact set'}</span>
                        <Badge variant="outline">{l.stage}</Badge>
                      </a>
                    ))}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="skills" className="pt-2 space-y-4">
          <p className="text-sm text-muted-foreground">
            Run a lead-scoped skill against this lead's data. Output opens in a new tab so you can keep this dialog open.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {leadSkills.map((s) => (
              <button
                key={s.id}
                className="flex items-start gap-3 rounded-md border p-3 text-left hover:border-blue-400 hover:bg-accent transition-colors disabled:opacity-50"
                onClick={() => runSkill(s.id, s.name)}
                disabled={running === s.id}
              >
                <Sparkles className="h-4 w-4 mt-0.5 text-violet-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{s.description}</p>
                </div>
                {running === s.id && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
              </button>
            ))}
          </div>

          {skillRuns.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Past runs</p>
              <div className="space-y-1.5">
                {skillRuns.map((r) => (
                  <a
                    key={r.id}
                    href={`/skills/${r.skillId}?leadId=${lead.id}&runId=${r.id}`}
                    target="_blank"
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
                  >
                    <div>
                      <p className="font-medium">{r.skillName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelative(r.createdAt)} · {r.runnerType === 'script' ? '⚡ script' : '🧠 LLM'}
                      </p>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex justify-between items-center border-t pt-3 text-xs text-muted-foreground">
        <span>
          Created {formatDateTime(lead.createdAt)} · Updated {formatRelative(lead.updatedAt)}
        </span>
      </div>

      {stageChangeTarget && (
        <StageChangeDialog
          leadId={lead.id}
          open
          onOpenChange={(o) => !o && setStageChangeTarget(null)}
          target={stageChangeTarget.key}
          targetLabel={stageChangeTarget.label}
          pendingSubStatusKeys={pendingSubStatuses.map((s) => s.key)}
          onDone={handleStageChangeDone}
        />
      )}
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div>{children}</div>
    </div>
  )
}
