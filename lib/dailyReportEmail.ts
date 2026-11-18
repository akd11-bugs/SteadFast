import { prisma } from '@/lib/db'
import { sendEmailAs } from '@/lib/email'

const ACTOR_ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'stage_change']

const TYPE_LABELS: Record<string, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  stage_change: 'Stage change',
}

const IST = 'Asia/Kolkata'

function dayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999)
  return { start, end }
}

function yesterday(): Date {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).format(date)
}

export interface DailyReportResult {
  recipients: string[]
  reportDate: string
}

// Rep-wise activity for a single calendar day in one org, emailed to every
// active admin in that org — every call, email, meeting, note, and stage
// move (e.g. "New → Pending — Our Side") each rep logged, not just a count.
// Defaults to yesterday so a morning cron run reports on the day that just
// finished. Orgs are flat and isolated (see app/api/cron/daily-activity-report),
// so this always reports on exactly one org, never a multi-org rollup.
export async function sendDailyActivityReportEmail(orgId: string, date: Date = yesterday()): Promise<DailyReportResult> {
  const { start, end } = dayRange(date)
  const reportDate = start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })

  const [admins, createdLeads, wonLeads, activities] = await Promise.all([
    prisma.user.findMany({
      where: { orgId, role: 'admin', isActive: true },
      select: { id: true, email: true, gmailRefreshTokenEnc: true },
    }),
    prisma.lead.count({ where: { orgId, createdAt: { gte: start, lte: end } } }),
    prisma.lead.count({ where: { orgId, wonAt: { gte: start, lte: end } } }),
    prisma.activity.findMany({
      where: { orgId, date: { gte: start, lte: end }, authorName: { not: 'System' }, type: { in: ACTOR_ACTIVITY_TYPES } },
      select: { type: true, description: true, authorName: true, date: true, lead: { select: { company: { select: { name: true } } } } },
      orderBy: { date: 'asc' },
    }),
  ])

  const byRep = new Map<string, typeof activities>()
  for (const a of activities) {
    const list = byRep.get(a.authorName) ?? []
    list.push(a)
    byRep.set(a.authorName, list)
  }
  const reps = Array.from(byRep.entries()).sort((a, b) => b[1].length - a[1].length)

  const lines = [
    `Daily activity report — ${reportDate}`,
    '',
    `Leads created: ${createdLeads}`,
    `Leads won: ${wonLeads}`,
    `Activities logged: ${activities.length}`,
    '',
    'By rep:',
  ]
  if (reps.length === 0) {
    lines.push('  No activity logged.')
  } else {
    for (const [name, repActivities] of reps) {
      lines.push('', `${name} (${repActivities.length}):`)
      for (const a of repActivities) {
        lines.push(
          `  ${formatTime(a.date)} · ${TYPE_LABELS[a.type] ?? a.type} · ${a.lead.company?.name ?? 'Unknown company'} — ${a.description}`
        )
      }
    }
  }

  const recipients = admins.map((a) => a.email)
  const subject = `Daily activity report — ${reportDate}`
  const body = lines.join('\n')
  // One recipient list on a single send, rather than one connection per
  // admin — this org's mailbox is resolved once instead of once per admin.
  // Sent from an admin's connected Gmail (HTTPS) when one exists: plain
  // SMTP is blocked on Render. sendEmailAs falls back to the org/global
  // SMTP mailbox when nobody has connected Gmail.
  if (recipients.length > 0) {
    const sender = admins.find((a) => a.gmailRefreshTokenEnc) ?? admins[0]
    await sendEmailAs(sender.id, { to: recipients.join(', '), subject, body })
  }

  return { recipients, reportDate }
}
