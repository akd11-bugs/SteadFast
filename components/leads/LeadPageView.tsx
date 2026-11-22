'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Trash2, Building2 } from 'lucide-react'
import { STAGE_LABELS, SOURCE_LABELS, boardColumnFor, type Stage, type LeadSource, type Lead } from '@/lib/types'
import { usePipelineConfig } from '@/lib/hooks/usePipelineConfig'
import { useRouter } from 'next/navigation'
import { LeadRecordView } from './LeadRecordView'

// Thin Client Component bridge: the /leads/[id] page is a Server Component
// and can't pass a render-prop function (renderHeader) across that boundary,
// so this is where the plain-page header (vs. LeadDetailDialog's Radix
// DialogTitle/DialogDescription header) actually gets defined.
export function LeadPageView({ initialLead }: { initialLead: Lead }) {
  const router = useRouter()
  const { columns } = usePipelineConfig()

  return (
    <LeadRecordView
      initialLead={initialLead}
      onDeleted={() => router.push('/leads')}
      renderHeader={({ lead, deleteLead }) => (
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2 truncate">
              <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
              <Link href={`/companies/${lead.companyId}`} className="hover:underline truncate">
                {lead.company.name}
              </Link>
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
              {lead.person?.name && (
                <>
                  <span className="font-medium text-foreground">{lead.person.name}</span>
                  <span>·</span>
                </>
              )}
              <Badge variant="outline">{columns.find((c) => c.key === boardColumnFor(lead))?.label ?? STAGE_LABELS[lead.stage as Stage] ?? lead.stage}</Badge>
              <span>·</span>
              <span>{SOURCE_LABELS[lead.source as LeadSource] ?? lead.source}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={deleteLead} aria-label="Delete lead">
            <Trash2 className="h-4 w-4 text-rose-500" />
          </Button>
        </div>
      )}
    />
  )
}
