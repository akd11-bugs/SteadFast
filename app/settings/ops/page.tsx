import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireUser, isAdmin } from '@/lib/session'
import { prisma } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatTile } from '@/components/dashboard/StatTile'
import { ScrollText, CheckCircle2, XCircle, Activity as ActivityIcon } from 'lucide-react'

export const dynamic = 'force-dynamic'

const JOB_LABELS: Record<string, string> = {
  'sync-leads-sheet': 'Google Sheet lead sync',
  'daily-activity-report': 'Daily activity report email',
}

function timeAgo(date: Date): string {
  const ms = Date.now() - date.getTime()
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default async function OpsDashboardPage() {
  const user = await requireUser()
  if (!isAdmin(user)) redirect('/')

  const orgIds = user.visibleOrgIds

  // Last run per jobKey, scoped to the visible org tree — jobs run before
  // Phase 0 (orgId null) still show up for the root org's admin.
  const recentRuns = await prisma.jobRun.findMany({
    where: { OR: [{ orgId: { in: orgIds } }, { orgId: null }] },
    orderBy: { finishedAt: 'desc' },
    take: 50,
  })
  const latestByJob = new Map<string, (typeof recentRuns)[number]>()
  for (const run of recentRuns) {
    if (!latestByJob.has(run.jobKey)) latestByJob.set(run.jobKey, run)
  }

  // "Needs review" count per job run, scoped to the same recent window — an
  // unresolved JobRunIssue (skipped row or sheet status that didn't map to a
  // real pipeline stage) only ever attaches to one of the runs above.
  const recentRunIds = recentRuns.map((r) => r.id)
  const issueCounts = recentRunIds.length
    ? await prisma.jobRunIssue.groupBy({
        by: ['jobRunId'],
        where: { jobRunId: { in: recentRunIds }, resolvedAt: null },
        _count: { _all: true },
      })
    : []
  const issueCountByJobRunId = new Map(issueCounts.map((c) => [c.jobRunId, c._count._all]))

  const [skillRunCount, llmSkillRunCount, scriptSkillRunCount] = await Promise.all([
    prisma.skillRun.count({ where: { orgId: { in: orgIds } } }),
    prisma.skillRun.count({ where: { orgId: { in: orgIds }, runnerType: 'llm' } }),
    prisma.skillRun.count({ where: { orgId: { in: orgIds }, runnerType: 'script' } }),
  ])

  const [leadCount, userCount] = await Promise.all([
    prisma.lead.count({ where: { orgId: { in: orgIds } } }),
    prisma.user.count({ where: { orgId: { in: orgIds }, isActive: true } }),
  ])

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
          <p className="text-sm text-muted-foreground">
            System health and usage across your organization{orgIds.length > 1 ? ' and its sub-organizations' : ''}.
          </p>
        </div>
        <Link href="/settings/audit-log">
          <Button variant="outline" size="sm">
            <ScrollText className="h-4 w-4" />
            Audit log
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Active users" value={userCount} />
        <StatTile label="Leads" value={leadCount} />
        <StatTile label="Skill runs" value={skillRunCount} hint={`${scriptSkillRunCount} free · ${llmSkillRunCount} LLM (~$0.05–0.30 each)`} />
        <StatTile label="Sub-organizations" value={Math.max(0, orgIds.length - 1)} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Scheduled job health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {Object.entries(JOB_LABELS).map(([jobKey, label]) => {
            const run = latestByJob.get(jobKey)
            const needsReview = run ? (issueCountByJobRunId.get(run.id) ?? 0) : 0
            return (
              <div key={jobKey} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {run?.status === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  ) : run?.status === 'failure' ? (
                    <XCircle className="h-4 w-4 text-rose-600 shrink-0" />
                  ) : (
                    <ActivityIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="font-medium truncate">{label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {run ? (
                    <>
                      <Badge variant={run.status === 'success' ? 'outline' : 'secondary'} className="text-[10px]">
                        {run.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{timeAgo(run.finishedAt)}</span>
                      {needsReview > 0 && (
                        <Link href={`/settings/ops/${run.id}/review`}>
                          <Badge variant="destructive" className="text-[10px]">
                            {needsReview} need{needsReview === 1 ? 's' : ''} review
                          </Badge>
                        </Link>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">No runs recorded yet</span>
                  )}
                </div>
              </div>
            )
          })}
          {recentRuns.some((r) => r.status === 'failure') && (
            <p className="text-xs text-muted-foreground pt-1">
              A failed run logs its error internally — check server logs for the stack trace (see the
              lms-debug-investigate skill for the general approach).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
