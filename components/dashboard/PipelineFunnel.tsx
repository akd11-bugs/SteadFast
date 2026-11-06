'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, LabelList } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency, cn } from '@/lib/utils'
import { BOARD_COLUMN_COLORS } from '@/lib/types'
import type { BoardColumn } from '@/lib/boardColumns'

interface PipelineData {
  stage: string
  count: number
  value: number
}

// `columns` is the org's real (possibly custom) stage list, built
// server-side by lib/pipelineConfig.ts's buildBoardColumns() — same
// function the Kanban board uses via usePipelineConfig(), so a custom
// stage an admin adds shows up here too instead of being silently
// dropped (this component previously built its own rows from lib/types.ts's
// fixed BOARD_COLUMNS, which `data` could contain stages outside of).
export function PipelineFunnel({ data, columns }: { data: PipelineData[]; columns: BoardColumn[] }) {
  const router = useRouter()
  const byStage = new Map(data.map((d) => [d.stage, d]))
  const rows = columns.map((c) => ({
    stage: c.key,
    label: c.label,
    color: c.color ?? BOARD_COLUMN_COLORS.new,
    count: byStage.get(c.key)?.count ?? 0,
    value: byStage.get(c.key)?.value ?? 0,
  }))
  const totalLeads = rows.reduce((sum, r) => sum + r.count, 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Pipeline by stage</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 24, right: 8, left: 0, bottom: 8 }}>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                style={{ fontSize: 11 }}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={50}
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} style={{ fontSize: 11 }} />
              <Tooltip
                cursor={{ fill: 'transparent' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="font-medium">{d.label}</p>
                      <p className="text-muted-foreground">{d.count} leads</p>
                      <p className="text-muted-foreground">{formatCurrency(d.value)}</p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d) => router.push(`/leads?stage=${d.payload.stage}`)}>
                {rows.map((r) => (
                  <Cell key={r.stage} fill={r.color} />
                ))}
                <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="grid gap-1 mt-2 text-center" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
          {rows.map((r) => (
            <Link key={r.stage} href={`/leads?stage=${r.stage}`} className="text-[10px] rounded hover:bg-accent/60">
              <p className={cn('font-semibold tabular-nums')}>{formatCurrency(r.value)}</p>
            </Link>
          ))}
        </div>
        <div className="grid gap-1 mt-1 text-center" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
          {rows.map((r) => (
            <Link
              key={r.stage}
              href={`/leads?stage=${r.stage}`}
              className="text-[10px] text-muted-foreground hover:underline"
            >
              {totalLeads === 0 ? '—' : `${Math.round((r.count / totalLeads) * 100)}% of pipeline`}
            </Link>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Share of all current leads sitting in each stage right now — a snapshot of the current pipeline, not a cohort trend over time.
        </p>
      </CardContent>
    </Card>
  )
}