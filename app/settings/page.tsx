import { promises as fs } from 'fs'
import path from 'path'
import Link from 'next/link'
import { ScrollText } from 'lucide-react'
import { requireUser, isAdmin } from '@/lib/session'
import { prisma } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { getStageDefinitions, getOnboardingStepDefinitions, getPendingSubStatusDefinitions } from '@/lib/pipelineConfig'
import { SettingsTabs } from '@/components/settings/SettingsTabs'

async function checkSkillLibrary() {
  const libPath = process.env.SKILL_LIBRARY_PATH || path.join(process.cwd(), 'skills-library')
  const found = await fs
    .access(path.join(libPath, 'pipeline-hygiene-audit', 'SKILL.md'))
    .then(() => true)
    .catch(() => false)
  return { libPath, found }
}

export default async function SettingsPage() {
  const user = await requireUser()
  const admin = isAdmin(user)
  const skillLibrary = await checkSkillLibrary()
  // Own org only — the slug drives the per-org rep login link shown in the
  // PIN dialog (components/settings/OrganisationPanel.tsx).
  const org = admin ? await prisma.organization.findUnique({ where: { id: user.orgId }, select: { slug: true } }) : null

  const users = admin
    ? await prisma.user.findMany({
        where: { orgId: { in: user.visibleOrgIds } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      })
    : []
  const invites = admin
    ? await prisma.invite.findMany({ where: { orgId: { in: user.visibleOrgIds } }, orderBy: { createdAt: 'desc' } })
    : []
  const [stageDefs, stepDefs, fieldDefs, pendingSubStatusDefs] = admin
    ? await Promise.all([
        getStageDefinitions(user.orgId),
        getOnboardingStepDefinitions(user.orgId),
        prisma.leadFieldDefinition.findMany({ where: { orgId: user.orgId }, orderBy: { position: 'asc' } }),
        getPendingSubStatusDefinitions(user.orgId),
      ])
    : [[], [], [], []]

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Account, organization, pipeline, and connected tools.</p>
        </div>
        {admin && (
          <div className="flex items-center gap-2">
            <Link href="/settings/ops">
              <Button variant="outline" size="sm">
                Operations
              </Button>
            </Link>
            <Link href="/settings/audit-log">
              <Button variant="outline" size="sm">
                <ScrollText className="h-4 w-4" />
                Audit log
              </Button>
            </Link>
          </div>
        )}
      </div>

      <SettingsTabs
        isAdminUser={admin}
        skillLibrary={skillLibrary}
        envValues={{
          anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
          anthropicModel: process.env.ANTHROPIC_MODEL ?? null,
        }}
        orgSlug={org?.slug ?? null}
        users={users}
        invites={invites}
        stageDefs={stageDefs.map((s) => ({ id: s.id, key: s.key, label: s.label, isCore: s.isCore }))}
        stepDefs={stepDefs.map((s) => ({ id: s.id, key: s.key, label: s.label, isCore: s.isCore }))}
        fieldDefs={fieldDefs.map((f) => ({
          id: f.id,
          key: f.key,
          label: f.label,
          type: f.type as 'text' | 'number' | 'date' | 'select',
          options: f.options ? (JSON.parse(f.options) as string[]) : null,
          required: f.required,
        }))}
        pendingSubStatusDefs={pendingSubStatusDefs.map((s) => ({
          id: s.id,
          key: s.key,
          label: s.label,
          owner: s.owner as 'us' | 'external',
          isDefault: s.isDefault,
        }))}
      />
    </div>
  )
}
