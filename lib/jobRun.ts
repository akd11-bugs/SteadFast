import { prisma } from '@/lib/db'

export interface RecordJobRunInput {
  orgId?: string
  jobKey: string
  status: 'success' | 'failure'
  startedAt: Date
  error?: string
}

// Written once at the end of every cron-route handler — backs the ops
// dashboard's "last run" health view without depending on GitHub Actions API
// access (this session couldn't authenticate to that from inside the app).
export async function recordJobRun(input: RecordJobRunInput): Promise<void> {
  await prisma.jobRun.create({
    data: {
      orgId: input.orgId ?? null,
      jobKey: input.jobKey,
      status: input.status,
      startedAt: input.startedAt,
      finishedAt: new Date(),
      error: input.error ?? null,
    },
  })
}

// Starts a JobRun row before the work it tracks has finished — used only by
// sync-leads-sheet, which needs the row's id up front to attach JobRunIssue
// rows (skipped/stage_unmapped) to the right run as importLeadRows creates
// them, mid-sync, before the final status is known. Call finishJobRun with
// the returned id once the work completes (success or failure); every other
// caller keeps using the simpler one-shot recordJobRun above.
export async function startJobRun(input: { orgId?: string; jobKey: string; startedAt: Date }): Promise<string> {
  const run = await prisma.jobRun.create({
    data: {
      orgId: input.orgId ?? null,
      jobKey: input.jobKey,
      status: 'success', // placeholder — overwritten by finishJobRun; never read while pending (no "running" UI state)
      startedAt: input.startedAt,
      finishedAt: input.startedAt,
    },
  })
  return run.id
}

export async function finishJobRun(id: string, input: { status: 'success' | 'failure'; error?: string }): Promise<void> {
  await prisma.jobRun.update({
    where: { id },
    data: { status: input.status, finishedAt: new Date(), error: input.error ?? null },
  })
}
