import { prisma } from '@/lib/db'
import { computeAlerts } from '@/lib/alerts'
import { StatTile, CurrencyTile } from '@/components/dashboard/StatTile'
import { AlertBanner } from '@/components/dashboard/AlertBanner'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { PipelineFunnel } from '@/components/dashboard/PipelineFunnel'
import { RepPerformance, type RepPerformanceRow } from '@/components/dashboard/RepPerformance'
import { SourceROI, type SourceROIRow } from '@/components/dashboard/SourceROI'
import { BDSummary, type BDSummaryData } from '@/components/dashboard/BDSummary'
import { GettingStartedCard } from '@/components/dashboard/GettingStartedCard'
import { Users, DollarSign, Target, TrendingUp, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { boardColumnFor, type LeadSource } from '@/lib/types'
import { redirect } from 'next/navigation'
import { requireUser, resolveSession, leadScope, isOperations } from '@/lib/session'
import { LandingPage } from '@/components/marketing/LandingPage'
import { getPendingSubStatusDefinitions, getStageDefinitions, buildBoardColumns } from '@/lib/pipelineConfig'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  // "/" is the public marketing page for a logged-out visitor, and the
  // dashboard for everyone else — same route, branching on session rather
  // than redirecting, so the marketing page can actually live at the root
  // domain like any other SaaS site. Every other non-'ok' resolution
  // (no-app-user, inactive) still goes through requireUser()'s existing
  // redirects below, unchanged — only a genuinely logged-out visitor sees
  // the marketing page instead of bouncing to /login.
  const resolution = await resolveSession()
  if (resolution.kind === 'no-session') return <LandingPage />

  const user = await requireUser()
  if (isOperations(user)) redirect('/onboarding')
  const [leads, pendingSubStatusDefs, stageDefs] = await Promise.all([
    prisma.lead.findMany({ where: leadScope(user), orderBy: { updatedAt: 'desc' } }),
    getPendingSubStatusDefinitions(user.orgId),
    getStageDefinitions(user.orgId),
  ])
  const pendingSubStatusOwners = Object.fromEntries(
    pendingSubStatusDefs.map((s) => [s.key, s.owner as 'us' | 'external']),
  )
  // The dashboard's own column list, built from the org's real (possibly
  // custom) stages — NOT lib/types.ts's fixed BOARD_COLUMNS. Passed to
  // PipelineFunnel so a custom stage shows up in the chart instead of
  // being silently dropped (previously that component built its own rows
  // from the fixed list, ignoring whatever funnelData below actually had).
  const boardColumns = buildBoardColumns(stageDefs, pendingSubStatusDefs)

  const alerts = computeAlerts(leads as any, pendingSubStatusOwners)

  // Getting-started steps, derived live from data that already exists.
  // Sample leads seeded for brand-new orgs (lib/org.ts's seedSampleLeads)
  // all use @example.com addresses — that's the one signal distinguishing
  // them from real leads without a new tracking column.
  const realLeadCount = leads.filter((l) => !l.email.endsWith('@example.com')).length
  const [teamMemberCount, sheetConnector] = await Promise.all([
    prisma.user.count({ where: { orgId: { in: user.visibleOrgIds } } }),
    prisma.orgSheetConnector.findUnique({ where: { orgId: user.orgId } }),
  ])

  const totalLeads = leads.length
  const wonThisMonth = leads.filter((l) => {
    if (!l.wonAt) return false
    const d = new Date(l.wonAt)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const openPipelineValue = leads
    .filter((l) => l.stage !== 'onboarding' && l.stage !== 'not_interested')
    .reduce((sum, l) => sum + l.estimatedVolume, 0)
  const wonValueThisMonth = wonThisMonth.reduce((sum, l) => sum + l.estimatedVolume, 0)
  const closedWon = leads.filter((l) => l.stage === 'onboarding').length
  const closedLost = leads.filter((l) => l.stage === 'not_interested').length
  // Counts as soon as sales marks a lead won (stage === 'onboarding'), not
  // only once ops finishes the sub-pipeline and onboardedAt is set.
  const conversionRate = totalLeads > 0 ? Math.round((closedWon / totalLeads) * 100) : 0

  // Pipeline by board column — Pending split into ours/merchant/PSP
  const byColumn = new Map<string, { count: number; value: number }>()
  for (const lead of leads) {
    const column = boardColumnFor(lead)
    const cur = byColumn.get(column) ?? { count: 0, value: 0 }
    cur.count++
    cur.value += lead.estimatedVolume
    byColumn.set(column, cur)
  }
  const funnelData = Array.from(byColumn.entries()).map(([stage, d]) => ({
    stage: stage as any,
    count: d.count,
    value: d.value,
  }))

  // Rep performance — open pipeline value + win rate per owner
  const byOwner = new Map<string, { openValue: number; totalLeads: number; won: number; lost: number }>()
  for (const lead of leads) {
    const cur = byOwner.get(lead.ownerName) ?? { openValue: 0, totalLeads: 0, won: 0, lost: 0 }
    cur.totalLeads++
    if (lead.stage !== 'onboarding' && lead.stage !== 'not_interested') cur.openValue += lead.estimatedVolume
    if (lead.stage === 'onboarding') cur.won++
    if (lead.stage === 'not_interested') cur.lost++
    byOwner.set(lead.ownerName, cur)
  }
  const repPerformance: RepPerformanceRow[] = Array.from(byOwner.entries())
    .map(([ownerName, d]) => ({
      ownerName,
      openValue: d.openValue,
      totalLeads: d.totalLeads,
      winRate: d.won + d.lost > 0 ? Math.round((d.won / (d.won + d.lost)) * 100) : -1,
    }))
    .sort((a, b) => b.openValue - a.openValue)

  // Source ROI — total value + win rate per lead source
  const bySource = new Map<LeadSource, { value: number; count: number; won: number; lost: number }>()
  for (const lead of leads) {
    const source = lead.source as LeadSource
    const cur = bySource.get(source) ?? { value: 0, count: 0, won: 0, lost: 0 }
    cur.value += lead.estimatedVolume
    cur.count++
    if (lead.stage === 'onboarding') cur.won++
    if (lead.stage === 'not_interested') cur.lost++
    bySource.set(source, cur)
  }
  const sourceROI: SourceROIRow[] = Array.from(bySource.entries())
    .map(([source, d]) => ({
      source,
      value: d.value,
      count: d.count,
      winRate: d.won + d.lost > 0 ? Math.round((d.won / (d.won + d.lost)) * 100) : -1,
    }))
    .sort((a, b) => b.value - a.value)

  // BD summary — partners/merchants onboarded this month, and what's forecast
  // to close by month end. Mirrors the manual WhatsApp BD report format.
  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999)
  const inCurrentMonth = (d: Date | null) => !!d && d >= monthStart && d <= monthEnd

  function bdMetricsFor(rows: typeof leads) {
    // wonAt (set the moment sales marks the deal won), not onboardedAt (set
    // only once ops finishes the sub-pipeline, possibly much later) — a won
    // merchant/partner should show up here immediately, same as Conversion Rate.
    const partnersOnboarded = rows.filter((l) => l.type === 'partner' && inCurrentMonth(l.wonAt)).length
    const merchantsOnboarded = rows.filter((l) => l.type === 'merchant' && inCurrentMonth(l.wonAt)).length
    const expected = rows.filter((l) => !l.wonAt && inCurrentMonth(l.expectedCloseDate))
    return {
      partnersOnboarded,
      merchantsOnboarded,
      expectedCount: expected.length,
      expectedVolume: expected.reduce((sum, l) => sum + l.estimatedVolume, 0),
    }
  }

  const bdSummary: BDSummaryData = {
    ...bdMetricsFor(leads),
    byOwner: Array.from(new Set(leads.map((l) => l.ownerName))).map((ownerName) => ({
      ownerName,
      ...bdMetricsFor(leads.filter((l) => l.ownerName === ownerName)),
    })),
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            A diagnostic surface. Skill alerts fire when your data asks for them.
          </p>
        </div>
        <Link href="/services">
          <Button variant="outline" size="sm">
            <Sparkles className="h-4 w-4" />
            Browse all services
          </Button>
        </Link>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CurrencyTile
          label="Open pipeline"
          value={openPipelineValue}
          hint={`${leads.filter((l) => l.stage !== 'onboarding' && l.stage !== 'not_interested').length} open leads`}
          icon={<DollarSign className="h-4 w-4" />}
          href="/leads?filter=open-pipeline"
        />
        <StatTile
          label="Total leads"
          value={totalLeads}
          hint={`${closedWon} won · ${closedLost} lost`}
          icon={<Users className="h-4 w-4" />}
          href="/leads"
        />
        <CurrencyTile
          label="Won this month"
          value={wonValueThisMonth}
          hint={`${wonThisMonth.length} deals`}
          icon={<TrendingUp className="h-4 w-4" />}
          href="/leads?filter=won-this-month"
        />
        <StatTile
          label="Conversion rate"
          value={`${conversionRate}%`}
          hint={`${closedWon} / ${totalLeads} won`}
          icon={<Target className="h-4 w-4" />}
          href="/leads?filter=won"
        />
      </div>

      <GettingStartedCard
        realLeadCount={realLeadCount}
        teamMemberCount={teamMemberCount}
        sheetConnected={!!sheetConnector}
      />

      {/* BD summary */}
      <BDSummary data={bdSummary} />

      {/* Skill alerts */}
      <AlertBanner alerts={alerts} />

      {/* Pipeline + activity */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PipelineFunnel data={funnelData} columns={boardColumns} />
        </div>
        <ActivityFeed limit={8} />
      </div>

      {/* Analytics */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RepPerformance rows={repPerformance} />
        <SourceROI rows={sourceROI} />
      </div>
    </div>
  )
}