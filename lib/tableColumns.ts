import {
  SOURCE_LABELS,
  LEAD_TYPE_LABELS,
  QUALITY_LABELS,
  BUSINESS_TYPE_LABELS,
  STAGE_LABELS,
  boardColumnFor,
  type Lead,
  type LeadSource,
  type LeadType,
  type QualityLevel,
  type BusinessType,
  type Stage,
} from '@/lib/types'
import type { LeadFieldOption } from '@/lib/hooks/usePipelineConfig'
import { formatCurrency, formatDate } from '@/lib/utils'

export type ColumnType = 'text' | 'number' | 'date' | 'select'

export interface TableColumn<TRow> {
  key: string
  label: string
  type: ColumnType
  getValue: (row: TRow) => React.ReactNode
  // Only set for 'number' columns — what Sum/Average calculate over. Display
  // (getValue) and calculation (getNumericValue) are separate on purpose:
  // a formatted "₹1,20,000" string isn't safe to re-parse for math.
  getNumericValue?: (row: TRow) => number | null
}

export interface CompanyRow {
  id: string
  name: string
  industry: string | null
  businessType: string | null
  website: string | null
  createdAt: string | Date
  _count: { leads: number; people: number }
}

/**
 * Built-in Lead columns merged with this org's custom fields
 * (LeadFieldDefinition — already exists, see components/settings/CustomFieldsCard.tsx)
 * so a custom field shows up in the table's "+ add column" picker exactly
 * like a built-in one, with no separate code path.
 */
// `columnLabels` is the org's board columns (usePipelineConfig), so a custom
// stage or renamed pending sub-status shows its real name, not the fixed default.
export function getLeadColumns(customFieldDefs: LeadFieldOption[], columnLabels: Record<string, string> = {}): TableColumn<Lead>[] {
  const builtins: TableColumn<Lead>[] = [
    { key: 'company', label: 'Company', type: 'text', getValue: (l) => l.company?.name ?? 'Unknown company' },
    { key: 'person', label: 'POC', type: 'text', getValue: (l) => l.person?.name ?? '—' },
    { key: 'email', label: 'Email', type: 'text', getValue: (l) => l.email },
    { key: 'phone', label: 'Phone', type: 'text', getValue: (l) => l.phone ?? '—' },
    { key: 'stage', label: 'Stage', type: 'select', getValue: (l) => columnLabels[boardColumnFor(l)] ?? STAGE_LABELS[l.stage as Stage] ?? l.stage },
    { key: 'source', label: 'Source', type: 'select', getValue: (l) => SOURCE_LABELS[l.source as LeadSource] ?? l.source },
    { key: 'type', label: 'Type', type: 'select', getValue: (l) => LEAD_TYPE_LABELS[l.type as LeadType] ?? l.type },
    { key: 'quality', label: 'Quality', type: 'select', getValue: (l) => QUALITY_LABELS[l.quality as QualityLevel] ?? l.quality },
    { key: 'effort', label: 'Effort', type: 'select', getValue: (l) => QUALITY_LABELS[l.effort as QualityLevel] ?? l.effort },
    {
      key: 'businessType',
      label: 'Business type',
      type: 'select',
      getValue: (l) => (l.businessType ? BUSINESS_TYPE_LABELS[l.businessType as BusinessType] : '—'),
    },
    { key: 'industry', label: 'Industry', type: 'text', getValue: (l) => l.industry ?? '—' },
    {
      key: 'estimatedVolume',
      label: 'Est. Volume',
      type: 'number',
      getValue: (l) => formatCurrency(l.estimatedVolume),
      getNumericValue: (l) => l.estimatedVolume,
    },
    { key: 'ownerName', label: 'Owner', type: 'text', getValue: (l) => l.ownerName },
    { key: 'createdAt', label: 'Created', type: 'date', getValue: (l) => formatDate(l.createdAt) },
    {
      key: 'lastActivityAt',
      label: 'Last activity',
      type: 'date',
      getValue: (l) => (l.lastActivityAt ? formatDate(l.lastActivityAt) : '—'),
    },
  ]

  const custom: TableColumn<Lead>[] = customFieldDefs.map((def) => ({
    key: `custom:${def.key}`,
    label: def.label,
    type: def.type === 'select' ? 'select' : def.type,
    getValue: (l) => {
      let values: Record<string, unknown> = {}
      try {
        values = l.customFieldsJson ? JSON.parse(l.customFieldsJson) : {}
      } catch {
        values = {}
      }
      const v = values[def.key]
      return v == null || v === '' ? '—' : String(v)
    },
    getNumericValue:
      def.type === 'number'
        ? (l) => {
            try {
              const values = l.customFieldsJson ? JSON.parse(l.customFieldsJson) : {}
              const v = values[def.key]
              return typeof v === 'number' ? v : null
            } catch {
              return null
            }
          }
        : undefined,
  }))

  return [...builtins, ...custom]
}

export function getCompanyColumns(): TableColumn<CompanyRow>[] {
  return [
    { key: 'name', label: 'Company', type: 'text', getValue: (c) => c.name },
    { key: 'industry', label: 'Industry', type: 'text', getValue: (c) => c.industry ?? '—' },
    {
      key: 'businessType',
      label: 'Business type',
      type: 'select',
      getValue: (c) => (c.businessType ? BUSINESS_TYPE_LABELS[c.businessType as BusinessType] : '—'),
    },
    { key: 'website', label: 'Website', type: 'text', getValue: (c) => c.website ?? '—' },
    { key: 'peopleCount', label: 'Contacts', type: 'number', getValue: (c) => c._count.people, getNumericValue: (c) => c._count.people },
    { key: 'leadsCount', label: 'Leads', type: 'number', getValue: (c) => c._count.leads, getNumericValue: (c) => c._count.leads },
    { key: 'createdAt', label: 'Created', type: 'date', getValue: (c) => formatDate(c.createdAt) },
  ]
}
