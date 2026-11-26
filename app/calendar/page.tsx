import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { istDate, istDayEnd, istParts } from '@/lib/istDate'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/db'
import { requireUser, leadScope, isAdmin, isOperations } from '@/lib/session'
import { boardColumnFor, BOARD_COLUMN_COLORS } from '@/lib/types'
import { CalendarMonth, type CalendarDay } from '@/components/calendar/CalendarMonth'

export const dynamic = 'force-dynamic'

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>
}) {
  const user = await requireUser()
  const { y, m } = await searchParams

  // Days are India-time days (lib/istDate.ts); the server clock is UTC.
  const today = istParts()
  const yNum = Number(y)
  const mNum = Number(m)
  const year = Number.isInteger(yNum) && yNum >= 1970 && yNum <= 9999 ? yNum : today.y
  const month = Number.isInteger(mNum) && mNum >= 1 && mNum <= 12 ? mNum - 1 : today.m

  const firstDow = istParts(istDate(year, month, 1)).dow
  const daysInMonth = istParts(istDate(year, month + 1, 0)).d
  const cells = Math.ceil((firstDow + daysInMonth) / 7) * 7
  const gridStart = istDate(year, month, 1 - firstDow)
  const gridEnd = istDayEnd(year, month, cells - firstDow)
  const dayKey = (at: Date) => {
    const p = istParts(at)
    return `${p.y}-${p.m}-${p.d}`
  }
  const todayKey = `${today.y}-${today.m}-${today.d}`

  const tasks = await prisma.task.findMany({
    where: {
      orgId: { in: user.visibleOrgIds },
      ...(isAdmin(user) || isOperations(user) ? {} : { ownerId: user.id }),
      dueDate: { gte: gridStart, lte: gridEnd },
    },
    orderBy: { dueDate: 'asc' },
    include: { lead: { select: { id: true, company: { select: { name: true } } } } },
  })

  const leadsClosing = await prisma.lead.findMany({
    where: { ...leadScope(user), expectedCloseDate: { gte: gridStart, lte: gridEnd } },
    orderBy: { expectedCloseDate: 'asc' },
    select: { id: true, stage: true, pendingSubStatus: true, expectedCloseDate: true, company: { select: { name: true } } },
  })

  const days: CalendarDay[] = Array.from({ length: cells }, (_, i) => {
    const date = istDate(year, month, 1 - firstDow + i)
    const p = istParts(date)
    const key = dayKey(date)
    return {
      date: date.toISOString(),
      label: String(p.d),
      isCurrentMonth: p.m === month,
      isToday: key === todayKey,
      tasks: tasks
        .filter((t) => t.dueDate && dayKey(t.dueDate) === key)
        .map((t) => ({
          id: t.id,
          title: t.title,
          done: t.done,
          leadId: t.leadId,
          leadCompany: t.lead?.company?.name ?? null,
        })),
      leads: leadsClosing
        .filter((l) => l.expectedCloseDate && dayKey(l.expectedCloseDate) === key)
        .map((l) => ({
          id: l.id,
          company: l.company.name,
          stageColor: BOARD_COLUMN_COLORS[boardColumnFor(l)] ?? BOARD_COLUMN_COLORS.new,
        })),
    }
  })

  const prev = new Date(Date.UTC(year, month - 1, 1))
  const next = new Date(Date.UTC(year, month + 1, 1))
  const monthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1)))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">Task due dates and lead close forecasts at a glance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/calendar?y=${prev.getUTCFullYear()}&m=${prev.getUTCMonth() + 1}`}>
            <Button variant="outline" size="icon">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <span className="min-w-[9rem] text-center text-sm font-medium">{monthLabel}</span>
          <Link href={`/calendar?y=${next.getUTCFullYear()}&m=${next.getUTCMonth() + 1}`}>
            <Button variant="outline" size="icon">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
      <CalendarMonth days={days} />
    </div>
  )
}
