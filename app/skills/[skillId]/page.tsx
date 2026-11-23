import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSkill } from '@/lib/skills/catalog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Sparkles, Zap } from 'lucide-react'
import { SkillRunner } from '@/components/skills/SkillRunner'
import { prisma } from '@/lib/db'
import { requireUser, leadScope, isAdmin, isOperations } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function SkillOutputPage({
  params,
  searchParams,
}: {
  params: Promise<{ skillId: string }>
  searchParams: Promise<{ leadId?: string; runId?: string }>
}) {
  const user = await requireUser()
  const { skillId } = await params
  const { leadId, runId } = await searchParams
  const skill = getSkill(skillId)
  if (!skill) notFound()

  // If a specific runId is provided, load it for the "view past run" flow.
  // A lead-linked run is only shown if the lead is still in this user's scope
  // — otherwise treat it as not found rather than leaking another rep's data.
  let pastRun: Awaited<ReturnType<typeof prisma.skillRun.findUnique>> | null = null
  if (runId) {
    // findFirst + org: findUnique by a URL id skipped the tenant filter (audit 2026-11-23).
    const run = await prisma.skillRun.findFirst({ where: { id: runId, orgId: { in: user.visibleOrgIds } } })
    if (run?.leadId) {
      const visible = await prisma.lead.findFirst({
        where: { id: run.leadId, ...leadScope(user) },
        select: { id: true },
      })
      pastRun = visible ? run : null
    } else {
      // Portfolio runs cover every lead in the org, so only roles that see every lead may open them.
      pastRun = run && (isAdmin(user) || isOperations(user)) ? run : null
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/skills">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">{skill.name}</h1>
            <Badge variant={skill.runnerType === 'script' ? 'success' : 'secondary'} className="gap-1">
              {skill.runnerType === 'script' ? (
                <>
                  <Zap className="h-3 w-3" /> Instant
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" /> Claude
                </>
              )}
            </Badge>
            <Badge variant="outline">{skill.scope}</Badge>
            <Badge variant="outline">{skill.outputType}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{skill.description}</p>
        </div>
      </div>

      <SkillRunner skillId={skillId} leadId={leadId} pastRun={pastRun as any} />
    </div>
  )
}