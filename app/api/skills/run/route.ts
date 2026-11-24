import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { runSkill } from '@/lib/skills/runner'
import { requireApiUser, leadScope } from '@/lib/session'
import { checkRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

// Each LLM run costs real money. Per org, so one team can't burn the budget.
// shortcut: in-memory limiter is per server process, move to a DB counter when we run more than one instance.
const RUNS_PER_HOUR = 20
const MAX_QUESTION_CHARS = 2_000

export async function POST(req: Request) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { skillId, leadId, userQuestion } = body ?? {}
  if (typeof skillId !== 'string' || !skillId) return NextResponse.json({ error: 'skillId required' }, { status: 400 })
  if (userQuestion != null && (typeof userQuestion !== 'string' || userQuestion.length > MAX_QUESTION_CHARS)) {
    return NextResponse.json({ error: `Question must be text under ${MAX_QUESTION_CHARS} characters` }, { status: 400 })
  }
  if (leadId != null && typeof leadId !== 'string') return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (leadId) {
    const owned = await prisma.lead.findFirst({ where: { id: leadId, ...leadScope(user) }, select: { id: true } })
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const limit = checkRateLimit(`skill-run:${user.orgId}`, RUNS_PER_HOUR, 60 * 60 * 1000)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Your team has hit the hourly skill-run limit. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  // Load data the skill needs — scoped to what this user is allowed to see
  const leads = await prisma.lead.findMany({
    where: leadScope(user),
    // Only the 3 newest activities are ever sent; _count keeps the true total.
    include: {
      activities: { orderBy: { date: 'desc' }, take: 3 },
      _count: { select: { activities: true } },
      company: true,
      person: true,
    },
    orderBy: { updatedAt: 'desc' },
  })

  // Determine scope
  const scope: 'portfolio' | 'lead' = leadId ? 'lead' : 'portfolio'

  const result = await runSkill({
    skillId,
    scope,
    leadId,
    leads: leads as any,
    userQuestion,
  })

  if (!result.ok) {
    // The raw error can hold file paths, Python tracebacks or provider bodies.
    console.error(`skill run failed (${result.skillId}):`, result.error)
    return NextResponse.json({ error: 'Skill run failed. Please try again.' }, { status: 500 })
  }

  // Persist the run
  try {
    const run = await prisma.skillRun.create({
      data: {
        orgId: user.orgId,
        skillId: result.skillId,
        skillName: result.skillName,
        scope,
        runnerType: result.runnerType,
        inputJson: JSON.stringify({ leadCount: leads.length, leadId, userQuestion }),
        outputMarkdown: result.outputMarkdown,
        outputStructured: result.outputStructured ? JSON.stringify(result.outputStructured) : null,
        leadId: leadId ?? null,
      },
    })
    return NextResponse.json({ ...result, runId: run.id })
  } catch (err) {
    // Persistence failed but skill ran — return the result anyway, without
    // leaking the raw Prisma error (can reveal schema/column details).
    console.error('Failed to persist skill run', err)
    return NextResponse.json({ ...result, persistenceError: 'Failed to save this run to history' })
  }
}