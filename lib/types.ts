// Shared types for LRM_blu
// Mirrors Prisma models but stays UI-friendly (Date objects, enums).

// New → Pending (whoever's turn it is to act) → Proposal (sent, awaiting a
// decision) → Onboarding (won) or Not Interested (lost, reason required).
export type Stage = 'new' | 'pending' | 'proposal' | 'onboarding' | 'not_interested'

export type LeadSource = 'website' | 'referral' | 'linkedin' | 'cold_outreach' | 'event' | 'form' | 'other'

// 'onboarding_step' and 'stage_change' are written server-side only (never
// user-selectable in the manual activity form):
// - 'onboarding_step' — app/api/leads/[id]/route.ts, on every
//   onboardingSubStage change. Its description always ends with
//   `(<subStageValue>)`, e.g. "(final_onboarded)" — the Reports page's
//   "Onboarded" metric filters on that exact suffix, so keep both in sync if
//   this format ever changes.
// - 'stage_change' — lib/leadStage.ts, on every stage or pendingSubStatus
//   change. Its description is exactly the remark the user typed (the "what
//   happened on this call" note), and doubles as the required reason when
//   the new stage is 'not_interested'.
export type ActivityType = 'call' | 'email' | 'meeting' | 'note' | 'onboarding_step' | 'stage_change'

export type QualityLevel = 'low' | 'medium' | 'high'

export type LeadType = 'partner' | 'merchant'

export type BusinessType = 'b2b' | 'b2c'

// Only meaningful when stage === 'pending'. Freely switchable in either
// direction (not a sequential checklist) — it just records whose turn it is
// to act next. Loosened from a fixed 3-value union to `string`, same
// reasoning as BoardColumnKey below: an org's actual sub-statuses come from
// PendingSubStatusDefinition (prisma/schema.prisma), fully admin
// add/remove/rename-able — 'pending_ours'/'pending_merchant'/'pending_psp'
// are just the seeded defaults, not a closed set.
export type PendingSubStatus = string

// Won leads go straight into onboarding — there is no separate "Won" resting
// state. Operated by the sales team for now; ops-team access comes later.
export type OnboardingSubStage = 'document_submission' | 'document_verification' | 'psp_verification' | 'final_onboarded'

export interface LeadCompany {
  id: string
  name: string
  website: string | null
  industry: string | null
  businessType: BusinessType | null
}

export interface LeadPerson {
  id: string
  name: string
  email: string | null
  phone: string | null
  jobTitle: string | null
  linkedinUrl: string | null
  otherLinksJson: string
}

export interface Lead {
  id: string
  companyId: string
  company: LeadCompany
  personId: string | null
  person: LeadPerson | null
  email: string
  phone: string | null
  website: string | null
  industry: string | null
  businessType: BusinessType | null
  source: LeadSource
  stage: Stage
  estimatedVolume: number
  ownerId: string
  ownerName: string
  effort: QualityLevel
  quality: QualityLevel
  type: LeadType
  wonAt: Date | string | null
  onboardedAt: Date | string | null
  expectedCloseDate: Date | string | null
  pendingSubStatus: PendingSubStatus | null
  onboardingSubStage: OnboardingSubStage | null
  assignedOpsId: string | null
  assignedOpsName: string | null
  intakeFormId: string | null
  intakeFormName: string | null
  painPoints: string
  whatTheyWant: string
  notes: string
  customFieldsJson?: string
  position: number
  createdAt: Date | string
  updatedAt: Date | string
  lastActivityAt: Date | string | null
  activities?: Activity[]
  _count?: { activities: number }
  skillRuns?: SkillRun[]
}

export interface Activity {
  id: string
  leadId: string
  type: ActivityType
  description: string
  authorName: string
  date: Date | string
}

export type TaskSource = 'manual' | 'alert' | 'sequence'

export interface Task {
  id: string
  leadId: string | null
  leadCompany?: string | null
  title: string
  dueDate: Date | string | null
  done: boolean
  source: TaskSource
  ownerId: string | null
  createdAt: Date | string
}

export interface SkillRun {
  id: string
  skillId: string
  skillName: string
  scope: string
  runnerType: 'script' | 'llm'
  inputJson: string
  outputMarkdown: string
  outputStructured: string | null
  leadId: string | null
  createdAt: Date | string
}

// UI metadata for stages
export const STAGES: Stage[] = ['new', 'pending', 'proposal', 'onboarding', 'not_interested']

export const STAGE_LABELS: Record<Stage, string> = {
  new: 'New',
  pending: 'Pending',
  proposal: 'Proposal',
  onboarding: 'Onboarding',
  not_interested: 'Not Interested',
}

export const STAGE_DESCRIPTIONS: Record<Stage, string> = {
  new: 'Just captured, not yet contacted',
  pending: 'Being worked — waiting on us, the merchant, or the PSP',
  proposal: 'Proposal sent, awaiting a decision',
  onboarding: 'Closed-won — document & PSP verification in progress',
  not_interested: 'Closed-lost, with a stated reason',
}

export const SOURCE_LABELS: Record<LeadSource, string> = {
  website: 'Website',
  referral: 'Referral',
  linkedin: 'LinkedIn',
  cold_outreach: 'Cold Outreach',
  event: 'Event',
  form: 'Form',
  other: 'Other',
}

export const SOURCES: LeadSource[] = ['website', 'referral', 'linkedin', 'cold_outreach', 'event', 'form', 'other']

export const QUALITY_LEVELS: QualityLevel[] = ['low', 'medium', 'high']

export const QUALITY_LABELS: Record<QualityLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

// Higher number sorts first when sorting "best first"
export const QUALITY_RANK: Record<QualityLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
}

export const LEAD_TYPES: LeadType[] = ['partner', 'merchant']

export const LEAD_TYPE_LABELS: Record<LeadType, string> = {
  partner: 'Partner',
  merchant: 'Merchant',
}

export const BUSINESS_TYPES: BusinessType[] = ['b2b', 'b2c']

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  b2b: 'B2B',
  b2c: 'B2C',
}

// Seeded defaults only (PendingSubStatusDefinition, lib/pipelineConfig.ts)
// — every real validation/lookup against an org's actual sub-statuses goes
// through that org's rows, never this constant directly, except as the
// fallback value used only where no org context is available at all.
export const PENDING_SUB_STATUSES: PendingSubStatus[] = ['pending_ours', 'pending_merchant', 'pending_psp']

export const PENDING_SUB_STATUS_LABELS: Record<string, string> = {
  pending_ours: 'Pending — our side',
  pending_merchant: 'Pending — merchant side',
  pending_psp: 'Pending — PSP side',
}

export type SubStatusOwner = 'us' | 'external'

// A "board column" is the actual unit Kanban, the Leads filter, and every
// stage-picking dropdown work in — it's `Stage` with 'pending' expanded into
// its three sub-statuses (which is why a PendingSubStatus value is also a
// valid BoardColumnKey; the string sets don't overlap with the other
// stages). This is a pure UI/selection concept — the database only ever
// stores `stage` + `pendingSubStatus` separately.
// Loosened from a fixed union to `string` so a custom (per-org) stage from
// StageDefinition (lib/pipelineConfig.ts) can be a board column too — the
// literal core values below are still always valid members of it.
export type BoardColumnKey = string

export const BOARD_COLUMNS: BoardColumnKey[] = [
  'new',
  'pending_ours',
  'pending_merchant',
  'pending_psp',
  'proposal',
  'onboarding',
  'not_interested',
]

export const BOARD_COLUMN_LABELS: Record<BoardColumnKey, string> = {
  new: 'New',
  pending_ours: 'Pending — Our Side',
  pending_merchant: 'Pending — Merchant',
  pending_psp: 'Pending — PSP',
  proposal: 'Proposal',
  onboarding: 'Onboarding',
  not_interested: 'Not Interested',
}

export const BOARD_COLUMN_DESCRIPTIONS: Record<BoardColumnKey, string> = {
  new: 'Just captured, not yet contacted',
  pending_ours: 'Our turn to follow up',
  pending_merchant: 'Waiting on the merchant to act',
  pending_psp: 'Waiting on the PSP to act',
  proposal: 'Proposal sent, awaiting a decision',
  onboarding: 'Closed-won — document & PSP verification in progress',
  not_interested: 'Closed-lost, with a stated reason',
}

// Single source of truth for board-column color — a graduated neutral-to-blue
// ramp for the in-flight stages, with saturated color reserved for the two
// terminal states (green for won, rust for lost) so hue carries meaning
// instead of a different color per column. Used as the default wherever a
// column has no admin-set StageDefinition.color (lib/hooks/usePipelineConfig.ts)
// and directly by the dashboard charts (components/dashboard/*).
export const BOARD_COLUMN_COLORS: Record<BoardColumnKey, string> = {
  new: '#94a3b8',
  pending_ours: '#7f93c2',
  pending_merchant: '#7f93c2',
  pending_psp: '#7f93c2',
  proposal: '#3f67c0',
  onboarding: '#16794f',
  not_interested: '#a93226',
}

// Where a lead currently sits, expanded to sub-column granularity. No
// hardcoded fallback sub-status here — this function has no org context to
// know which sub-status is actually the org's default, so a pending lead
// with no pendingSubStatus set (a transient state applyStageChange should
// always resolve before it's ever read back) just falls back to the bare
// 'pending' stage name as its column key.
export function boardColumnFor(lead: { stage: string; pendingSubStatus?: string | null }): BoardColumnKey {
  if (lead.stage === 'pending' && lead.pendingSubStatus) {
    return lead.pendingSubStatus
  }
  return lead.stage as BoardColumnKey
}

// Reverse mapping — what to PATCH to move a lead into this column. Always
// includes `stage` (harmless if unchanged) so a single call can move a lead
// from any column to any other, including New straight into a specific
// pending sub-status, in one request. `pendingSubStatusKeys` is the org's
// actual current set (PendingSubStatusDefinition) — falls back to the
// seeded-default constant only where no org context is available.
export function boardColumnToInput(
  column: BoardColumnKey,
  pendingSubStatusKeys: string[] = PENDING_SUB_STATUSES,
): { stage: Stage; pendingSubStatus?: PendingSubStatus } {
  if (pendingSubStatusKeys.includes(column)) {
    return { stage: 'pending', pendingSubStatus: column }
  }
  return { stage: column as Stage }
}

// Only meaningful when stage === 'onboarding'. Reaching 'final_onboarded' is
// what sets Lead.onboardedAt.
export const ONBOARDING_SUB_STAGES: OnboardingSubStage[] = [
  'document_submission',
  'document_verification',
  'psp_verification',
  'final_onboarded',
]

export const ONBOARDING_SUB_STAGE_LABELS: Record<OnboardingSubStage, string> = {
  document_submission: 'Document submission',
  document_verification: 'Document verification',
  psp_verification: 'PSP verification',
  final_onboarded: 'Final onboarded',
}

// Permissive domain/URL shape check — rejects whitespace-containing strings
// (e.g. a page title mistakenly landing in this field) while accepting bare
// domains and full URLs.
const WEBSITE_PATTERN = /^(https?:\/\/)?[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+([/?#]\S*)?$/

export function isValidWebsite(value: string): boolean {
  return WEBSITE_PATTERN.test(value.trim())
}

// Scheme allowlist for any value that will be rendered as an <a href> —
// rejects javascript:/data:/vbscript: URIs, which React does NOT sanitize
// in attribute position (only text content gets HTML-escaped). Used for
// Person.linkedinUrl and Person.otherLinksJson entries, both of which can
// originate from a scanned QR code's vCard URL field as well as free text.
export function isSafeUrl(value: string): boolean {
  const trimmed = value.trim()
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// Deliberately simple (no full RFC 5322 parsing) — this is a sanity check
// against garbage input, not a mailbox-existence guarantee.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}

// A ceiling on free-text fields — not tuned precisely, just enough to stop
// a multi-megabyte string from ever reaching the database on a field that
// should only ever hold a name, a note, or a phone number.
const FIELD_MAX_LENGTHS: Record<string, number> = {
  company: 200,
  poc: 200,
  email: 254,
  phone: 40,
  website: 500,
  industry: 100,
  ownerName: 200,
  notes: 10000,
  painPoints: 5000,
  whatTheyWant: 5000,
}

// Validates enum-like Lead fields present in a request body against the
// arrays above. Returns an error message, or null if everything present is
// valid. Fields absent from the body are left untouched (PATCH semantics).
export function validateLeadFields(
  body: Record<string, unknown>,
  options?: { validStageKeys?: string[]; validOnboardingStepKeys?: string[]; validPendingSubStatusKeys?: string[] }
): string | null {
  // Falls back to the static built-in lists when no org-scoped definitions are
  // passed (e.g. a caller that hasn't been updated yet) — every org starts
  // seeded with exactly these values anyway, see lib/pipelineConfig.ts.
  const stageKeys = options?.validStageKeys ?? STAGES
  const onboardingStepKeys = options?.validOnboardingStepKeys ?? ONBOARDING_SUB_STAGES
  const pendingSubStatusKeys = options?.validPendingSubStatusKeys ?? PENDING_SUB_STATUSES
  if (body.stage !== undefined && !stageKeys.includes(body.stage as string)) return `Invalid stage: ${body.stage}`
  if (body.source !== undefined && !SOURCES.includes(body.source as LeadSource)) return `Invalid source: ${body.source}`
  if (body.type !== undefined && !LEAD_TYPES.includes(body.type as LeadType)) return `Invalid type: ${body.type}`
  if (body.quality !== undefined && !QUALITY_LEVELS.includes(body.quality as QualityLevel)) return `Invalid quality: ${body.quality}`
  if (body.effort !== undefined && !QUALITY_LEVELS.includes(body.effort as QualityLevel)) return `Invalid effort: ${body.effort}`
  if (body.businessType != null && !BUSINESS_TYPES.includes(body.businessType as BusinessType)) return `Invalid businessType: ${body.businessType}`
  if (body.pendingSubStatus != null && !pendingSubStatusKeys.includes(body.pendingSubStatus as string)) return `Invalid pendingSubStatus: ${body.pendingSubStatus}`
  if (body.onboardingSubStage != null && !onboardingStepKeys.includes(body.onboardingSubStage as string)) return `Invalid onboardingSubStage: ${body.onboardingSubStage}`
  if (body.estimatedVolume !== undefined && !Number.isFinite(Number(body.estimatedVolume))) {
    return `Invalid estimatedVolume: ${body.estimatedVolume}`
  }
  if (body.website != null && body.website !== '' && !isValidWebsite(String(body.website))) {
    return `Invalid website: ${body.website}`
  }
  if (body.email != null && body.email !== '' && !isValidEmail(String(body.email))) {
    return `Invalid email: ${body.email}`
  }
  if (body.linkedinUrl != null && body.linkedinUrl !== '' && !isSafeUrl(String(body.linkedinUrl))) {
    return `Invalid linkedinUrl: ${body.linkedinUrl}`
  }
  if (Array.isArray(body.otherLinks)) {
    const badLink = body.otherLinks.find((l) => typeof l !== 'string' || !isSafeUrl(l))
    if (badLink !== undefined) return `Invalid otherLinks entry: ${badLink}`
  }
  for (const [field, max] of Object.entries(FIELD_MAX_LENGTHS)) {
    const value = body[field]
    if (typeof value === 'string' && value.length > max) {
      return `${field} is too long (max ${max} characters)`
    }
  }
  return null
}

// 1-indexed step out of the step list's length, as a whole percentage. Pass
// an org's actual OnboardingStepDefinition keys (in position order) once
// they're available — falls back to the static built-in list otherwise.
export function onboardingProgressPercent(subStage: string | null, stepKeys: string[] = ONBOARDING_SUB_STAGES): number {
  if (!subStage) return 0
  const idx = stepKeys.indexOf(subStage)
  if (idx === -1) return 0
  return Math.round(((idx + 1) / stepKeys.length) * 100)
}

// The whole-funnel checkpoint bar (New → Pending → Proposal → Onboarding →
// Onboarded) — distinct from onboardingProgressPercent, which only covers
// the fine-grained steps inside Onboarding. 'not_interested' has no place on
// this bar; callers check for it separately and show a terminal badge
// instead.
export const PIPELINE_CHECKPOINTS = ['new', 'pending', 'proposal', 'onboarding', 'onboarded'] as const
export type PipelineCheckpoint = (typeof PIPELINE_CHECKPOINTS)[number]

export function pipelineCheckpointIndex(lead: { stage: Stage; onboardingSubStage?: OnboardingSubStage | null }): number {
  if (lead.stage === 'new') return 0
  if (lead.stage === 'pending') return 1
  if (lead.stage === 'proposal') return 2
  if (lead.stage === 'onboarding') return lead.onboardingSubStage === 'final_onboarded' ? 4 : 3
  return 0
}