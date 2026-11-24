import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser, leadScope } from '@/lib/session'
import { readJsonBody } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  const url = new URL(req.url)
  const requestedLimit = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 20
  const leadId = url.searchParams.get('leadId')
  const activities = await prisma.activity.findMany({
    where: { lead: leadScope(user), ...(leadId ? { leadId } : {}) },
    orderBy: { date: 'desc' },
    take: limit,
    include: { lead: { select: { company: { select: { name: true } }, id: true } } },
  })
  const items = activities.map((a) => ({
    id: a.id,
    type: a.type,
    description: a.description,
    date: a.date,
    authorName: a.authorName,
    leadId: a.leadId,
    leadName: a.lead.company?.name ?? 'Unknown company',
  }))
  return NextResponse.json({ activities: items })
}

const USER_ACTIVITY_TYPES: unknown[] = ['call', 'email', 'meeting', 'note']

export async function POST(req: Request) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body
  if (!body.leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

  // Only user-loggable types. stage_change / onboarding_step are written by the
  // server and feed reports, so a client must not be able to forge them.
  const type = body.type ?? 'note'
  if (!USER_ACTIVITY_TYPES.includes(type)) {
    return NextResponse.json({ error: `type must be one of ${USER_ACTIVITY_TYPES.join(', ')}` }, { status: 400 })
  }
  const date = body.date ? new Date(body.date) : new Date()
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'date is not a valid date' }, { status: 400 })

  const lead = await prisma.lead.findFirst({ where: { id: body.leadId, ...leadScope(user) }, select: { id: true, orgId: true } })
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const activity = await prisma.activity.create({
    data: {
      orgId: lead.orgId,
      leadId: body.leadId,
      type,
      description: body.description ?? '',
      // Always the real session user — never trust a client-supplied name
      // (closes the gap that let Kanban drag-and-drop log activity as
      // authorName: 'System' instead of whoever actually moved the card).
      authorName: user.name,
      date,
    },
  })

  // Only ever move lastActivityAt forward: logging last week's call must not
  // make a lead touched today look stale. A future date counts as now.
  const touchedAt = activity.date > new Date() ? new Date() : activity.date
  await prisma.lead.updateMany({
    where: { id: lead.id, orgId: lead.orgId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: touchedAt } }] },
    data: { lastActivityAt: touchedAt },
  })

  return NextResponse.json({ activity })
}