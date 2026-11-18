import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { requireUser, isAdmin, isOperations } from '@/lib/session'
import { prisma } from '@/lib/db'
import { SyncReviewPanel } from '@/components/settings/SyncReviewPanel'

export const dynamic = 'force-dynamic'

const JOB_LABELS: Record<string, string> = {
  'sync-leads-sheet': 'Google Sheet lead sync',
}

export default async function SyncReviewPage({ params }: { params: Promise<{ jobRunId: string }> }) {
  const user = await requireUser()
  if (!isAdmin(user) && !isOperations(user)) redirect('/')
  const { jobRunId } = await params

  const jobRun = await prisma.jobRun.findFirst({
    where: { id: jobRunId, OR: [{ orgId: { in: user.visibleOrgIds } }, { orgId: null }] },
    select: { id: true, jobKey: true, finishedAt: true },
  })
  if (!jobRun) redirect('/settings/ops')

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/settings/ops">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review sync issues</h1>
          <p className="text-sm text-muted-foreground">
            {JOB_LABELS[jobRun.jobKey] ?? jobRun.jobKey} — run finished {jobRun.finishedAt.toLocaleString()}
          </p>
        </div>
      </div>

      <SyncReviewPanel jobRunId={jobRun.id} />
    </div>
  )
}
