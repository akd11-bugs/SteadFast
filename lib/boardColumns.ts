// Pure, dependency-free (no prisma/pg) so this can be imported from both a
// client hook (lib/hooks/usePipelineConfig.ts) and server code
// (lib/pipelineConfig.ts, app/page.tsx) without dragging server-only
// modules into the client bundle — that's why this isn't just defined
// inside lib/pipelineConfig.ts, which imports prisma.
import { BOARD_COLUMN_COLORS } from '@/lib/types'

export interface BoardColumn {
  key: string
  label: string
  description: string | null
  color: string | null
}

interface StageLike {
  key: string
  label: string
  description: string | null
  color: string | null
}

interface PendingSubStatusLike {
  key: string
  label: string
  owner: string
}

// Shared by lib/hooks/usePipelineConfig.ts (client components — Kanban,
// lead forms) AND app/page.tsx (server-rendered dashboard) so a custom
// stage/pending-sub-status an admin adds shows up identically everywhere,
// rather than each call site keeping its own copy of this expansion that
// could silently drift apart. Previously only the client hook had this,
// which is why the dashboard's PipelineFunnel chart (fed from a fixed
// lib/types.ts BOARD_COLUMNS array, not this) silently dropped any lead
// sitting in a custom stage — this function is the fix for that.
//
// Pending's sub-statuses expand into one column per the org's actual
// PendingSubStatusDefinition rows (fully admin add/remove/rename-able) —
// not a fixed 3-column list. All share the same neutral pending color
// since they're not individually colorable the way top-level stages are.
export function buildBoardColumns(stages: StageLike[], pendingSubStatuses: PendingSubStatusLike[]): BoardColumn[] {
  return stages.flatMap((s) =>
    s.key === 'pending'
      ? pendingSubStatuses.map((p) => ({
          key: p.key,
          label: p.label,
          description: p.owner === 'us' ? 'Our turn to follow up' : 'Waiting on them to act',
          color: BOARD_COLUMN_COLORS.pending_ours,
        }))
      : [{
          key: s.key,
          label: s.label,
          description: s.description,
          color: s.color ?? BOARD_COLUMN_COLORS[s.key as keyof typeof BOARD_COLUMN_COLORS] ?? BOARD_COLUMN_COLORS.new,
        }]
  )
}
