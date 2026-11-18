import crypto from 'crypto'
import type { WorkflowRule } from '@prisma/client'
import type { LeadWithRelations as Lead } from '@/lib/leadStage'
import { prisma } from '@/lib/db'
import { sendEmailAs } from '@/lib/email'
import { tryDecrypt } from '@/lib/crypto'
import { assertSafeWebhookUrl } from '@/lib/ssrfGuard'

interface StageChangedTrigger {
  toStage: string
}

interface CreateTaskAction {
  title: string
  dueInDays?: number
}

interface SendEmailAction {
  subject: string
  body: string
  to?: 'lead' | 'owner'
}

interface CallWebhookAction {
  url: string
  signingSecretEnc: string // AES-256-GCM ciphertext — see app/api/workflow-rules/route.ts
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

// Shared by send_email and call_webhook below — both log their result to
// the lead's activity feed and bump lastActivityAt the same way, only the
// type/description differ.
async function logAutomationActivity(
  lead: Lead,
  rule: WorkflowRule,
  entry: { type: string; description: string },
): Promise<void> {
  const activity = await prisma.activity.create({
    data: { orgId: lead.orgId, leadId: lead.id, type: entry.type, description: entry.description, authorName: `Automation — ${rule.name}` },
  })
  await prisma.lead.update({ where: { id: lead.id }, data: { lastActivityAt: activity.date } })
}

/**
 * Runs any of the acting rep's active "stage changed" rules that match the
 * lead's new stage. Evaluated inline at the one call site that produces this
 * trigger today — not a generic event bus, since there's only one.
 */
export async function evaluateStageRules(lead: Lead, newStage: string): Promise<void> {
  const rules = await prisma.workflowRule.findMany({
    where: { orgId: lead.orgId, ownerId: lead.ownerId, triggerType: 'stage_changed', active: true },
  })

  for (const rule of rules) {
    const trigger = parseJson<StageChangedTrigger>(rule.triggerConfig)
    if (trigger?.toStage !== newStage) continue
    // One failing rule must not stop the others, and the failure must be
    // visible on the lead, not only in the server log.
    try {
      await runAction(rule, lead)
    } catch (err) {
      console.error(`[workflow] rule ${rule.id} failed`, err)
      await logAutomationActivity(lead, rule, {
        type: 'note',
        description: `Automation failed (${rule.actionType}) — nothing was sent: ${err instanceof Error ? err.message : String(err)}`,
      }).catch(() => undefined)
    }
  }
}

async function runAction(rule: WorkflowRule, lead: Lead): Promise<void> {
  if (rule.actionType === 'create_task') {
    const config = parseJson<CreateTaskAction>(rule.actionConfig)
    if (!config?.title) return
    await prisma.task.create({
      data: {
        orgId: lead.orgId,
        leadId: lead.id,
        title: config.title,
        dueDate: config.dueInDays ? new Date(Date.now() + config.dueInDays * 24 * 60 * 60 * 1000) : null,
        source: 'sequence',
        ownerId: lead.ownerId,
      },
    })
    return
  }

  if (rule.actionType === 'send_email') {
    const config = parseJson<SendEmailAction>(rule.actionConfig)
    if (!config?.subject || !config?.body) return

    const sentToOwner = config.to === 'owner'
    let to: string | null = lead.email || null
    if (sentToOwner) {
      const owner = await prisma.user.findUnique({ where: { id: rule.ownerId }, select: { email: true } })
      to = owner?.email ?? null
    }
    if (!to) return

    // Only log "Sent" once the send actually succeeds — if sendEmailAs
    // throws, evaluateStageRules records a "failed" note instead.
    await sendEmailAs(rule.ownerId, { to, subject: config.subject, body: config.body })

    const descriptionPrefix = sentToOwner ? 'Notified owner: ' : 'Sent: '
    await logAutomationActivity(lead, rule, { type: 'email', description: `${descriptionPrefix}"${config.subject}"\n\n${config.body}` })
    return
  }

  if (rule.actionType === 'call_webhook') {
    const config = parseJson<CallWebhookAction>(rule.actionConfig)
    if (!config?.url || !config.signingSecretEnc) return

    const signingSecret = tryDecrypt(config.signingSecretEnc)
    if (!signingSecret) return // key rotated since — skip rather than throw

    const payload = JSON.stringify({
      event: 'lead.stage_changed',
      ruleId: rule.id,
      ruleName: rule.name,
      lead: { id: lead.id, company: lead.company?.name ?? 'Unknown company', email: lead.email, stage: lead.stage },
      timestamp: new Date().toISOString(),
    })
    const signature = crypto.createHmac('sha256', signingSecret).update(payload).digest('hex')

    // Unlike send_email above, a failure here does NOT propagate — an
    // external endpoint being slow, down, or never built is the normal case
    // for a webhook, and shouldn't block the stage change that triggered it
    // (the caller, lib/leadStage.ts, has already committed the stage change
    // by the time this runs). Logged to console for operator visibility;
    // see the enterprise-roadmap note about a real delivery log/retry.
    try {
      // Re-validated here, not just at save time in the route handler — a
      // hostname that resolved to a public IP when the rule was saved can be
      // re-pointed at an internal address by the time it actually fires
      // (DNS rebinding), so this is the enforcement point that actually matters.
      //
      // redirect: 'manual' closes the more practical bypass: a validated,
      // genuinely-public endpoint responding with a 3xx to an internal
      // Location header, which fetch's default redirect:'follow' would
      // otherwise chase with no re-validation at all. A narrower DNS-rebinding
      // race between this lookup and fetch()'s own internal resolution
      // remains (fetch does not expose a way to pin a connection to a
      // specific IP without a custom dispatcher), but requires an attacker
      // who controls authoritative DNS for the hostname with aggressive TTLs.
      await assertSafeWebhookUrl(config.url)
      const res = await fetch(config.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-signature': `sha256=${signature}` },
        body: payload,
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
      })
      if (res.status >= 300 && res.status < 400) {
        console.error(`workflow webhook call failed (rule ${rule.id}): refused to follow redirect (HTTP ${res.status})`)
        return
      }
      if (!res.ok) {
        console.error(`workflow webhook call failed (rule ${rule.id}): HTTP ${res.status}`)
        return
      }
    } catch (err) {
      console.error(`workflow webhook call failed (rule ${rule.id}):`, err)
      return
    }

    await logAutomationActivity(lead, rule, { type: 'note', description: `Webhook delivered to ${new URL(config.url).hostname}` })
  }
}
