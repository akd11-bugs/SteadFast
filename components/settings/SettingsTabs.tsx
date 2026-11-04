'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { STAGES, STAGE_LABELS, STAGE_DESCRIPTIONS, SOURCES, SOURCE_LABELS } from '@/lib/types'
import { OrganisationPanel } from '@/components/settings/OrganisationPanel'
import { EmailSettingsCard } from '@/components/settings/EmailSettingsCard'
import { SetPasswordCard } from '@/components/settings/SetPasswordCard'
import { OrgEmailSettingsCard } from '@/components/settings/OrgEmailSettingsCard'
import { OrgSheetConnectorCard } from '@/components/settings/OrgSheetConnectorCard'
import { LeadIntakeFormsCard } from '@/components/settings/LeadIntakeFormsCard'
import { AgentApiKeyCard } from '@/components/settings/AgentApiKeyCard'
import { McpConnectionsCard } from '@/components/settings/McpConnectionsCard'
import { ReportsApiKeyCard } from '@/components/settings/ReportsApiKeyCard'
import { WorkflowRulesCard } from '@/components/settings/WorkflowRulesCard'
import { PipelineConfigCard } from '@/components/settings/PipelineConfigCard'
import { CustomFieldsCard } from '@/components/settings/CustomFieldsCard'
import { PendingSubStatusCard } from '@/components/settings/PendingSubStatusCard'

interface StageDef {
  id: string
  key: string
  label: string
  isCore: boolean
}
interface PendingSubStatusDef {
  id: string
  key: string
  label: string
  owner: 'us' | 'external'
  isDefault: boolean
}
interface FieldDef {
  id: string
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  options: string[] | null
  required: boolean
}
interface UserRow {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
  createdAt: Date
}

interface SettingsTabsProps {
  isAdminUser: boolean
  skillLibrary: { libPath: string; found: boolean }
  envValues: { anthropicApiKey: string | null; anthropicModel: string | null }
  orgSlug: string | null
  users: UserRow[]
  invites: unknown[]
  joinRequests: unknown[]
  stageDefs: StageDef[]
  stepDefs: StageDef[]
  fieldDefs: FieldDef[]
  pendingSubStatusDefs: PendingSubStatusDef[]
}

// Groups the settings page's cards by what they're actually for, rather than
// one long scroll — see the sidebar/Settings redesign: 11 cards flat was the
// thing that prompted this. "Connectors" is specifically "anything that
// talks to an external AI/tool integration" (the MCP agent key, and the
// future bring-your-own-MCP-server feature) — kept separate from
// OrgSheetConnectorCard/LeadIntakeFormsCard/ReportsApiKeyCard, which are
// product-level external connections, not AI-tooling ones, and sit under
// General/Pipeline instead per that distinction.
export function SettingsTabs({
  isAdminUser,
  skillLibrary,
  envValues,
  orgSlug,
  users,
  invites,
  joinRequests,
  stageDefs,
  stepDefs,
  fieldDefs,
  pendingSubStatusDefs,
}: SettingsTabsProps) {
  return (
    <Tabs defaultValue="general">
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        {isAdminUser && <TabsTrigger value="organization">Organization</TabsTrigger>}
        <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        {isAdminUser && <TabsTrigger value="connectors">Connectors</TabsTrigger>}
        <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="space-y-6 pt-2">
        <SetPasswordCard />
        <EmailSettingsCard />
        {isAdminUser && <OrgEmailSettingsCard />}
      </TabsContent>

      {isAdminUser && (
        <TabsContent value="organization" className="pt-2">
          <OrganisationPanel
            initialUsers={users as never}
            initialInvites={invites as never}
            initialJoinRequests={joinRequests as never}
            orgSlug={orgSlug}
          />
        </TabsContent>
      )}

      <TabsContent value="pipeline" className="space-y-6 pt-2">
        {isAdminUser ? (
          <>
            <PipelineConfigCard
              initialStages={stageDefs.map((s) => ({ id: s.id, key: s.key, label: s.label, isCore: s.isCore }))}
              initialSteps={stepDefs.map((s) => ({ id: s.id, key: s.key, label: s.label, isCore: s.isCore }))}
            />
            <PendingSubStatusCard initialSubStatuses={pendingSubStatusDefs} />
            <CustomFieldsCard initialFields={fieldDefs} />
          </>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Pipeline stages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {STAGES.map((s) => (
                <div key={s} className="flex items-start justify-between gap-3 py-1.5">
                  <div>
                    <p className="text-sm font-medium">{STAGE_LABELS[s]}</p>
                    <p className="text-xs text-muted-foreground">{STAGE_DESCRIPTIONS[s]}</p>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {s}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {isAdminUser && <WorkflowRulesCard />}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lead sources</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {SOURCES.map((s) => (
              <div key={s} className="flex items-center gap-2 py-1">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {s}
                </Badge>
                <span className="text-sm">{SOURCE_LABELS[s]}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      {isAdminUser && (
        <TabsContent value="connectors" className="space-y-6 pt-2">
          <AgentApiKeyCard />
          <McpConnectionsCard />
          <OrgSheetConnectorCard />
          <LeadIntakeFormsCard />
          <ReportsApiKeyCard />
        </TabsContent>
      )}

      <TabsContent value="diagnostics" className="space-y-6 pt-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Skill library status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <EnvCheck label="Anthropic API key" value={envValues.anthropicApiKey} />
            <div className="flex items-center gap-2">
              {skillLibrary.found ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
              )}
              <span className="font-medium">Skill library</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs ml-auto truncate">
                {skillLibrary.found ? `found at ${skillLibrary.libPath}` : `missing — expected ${skillLibrary.libPath}`}
              </code>
            </div>
            <EnvCheck label="Anthropic model" value={envValues.anthropicModel} expected="claude-sonnet-4-5" />
            <p className="text-xs text-muted-foreground pt-2 border-t">
              Pipeline Hygiene Audit and Spam Folder Check work without an API key (local Python).
              Other skills require <code className="rounded bg-muted px-1">ANTHROPIC_API_KEY</code>.
            </p>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}

function EnvCheck({ label, value, expected }: { label: string; value: string | null; expected?: string }) {
  const ok = !!value
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
      )}
      <span className="font-medium">{label}</span>
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs ml-auto truncate">
        {ok ? `set — ${value.slice(0, 8)}…${expected ? ` (expected ${expected})` : ''}` : 'not set'}
      </code>
    </div>
  )
}
