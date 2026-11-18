import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser, isAdmin } from '@/lib/session'
import { readJsonBody } from '@/lib/http'
import { encrypt, generateRandomToken } from '@/lib/crypto'
import { assertSafeWebhookUrl } from '@/lib/ssrfGuard'

export const dynamic = 'force-dynamic'

const TRIGGER_TYPES = ['stage_changed']
const ACTION_TYPES = ['create_task', 'send_email', 'call_webhook']

// Strips actionConfig.signingSecretEnc before a rule ever reaches the
// client — it's write-only, same convention as User.gmailRefreshTokenEnc.
// The plaintext secret is shown exactly once, in the POST response below,
// since that's the only moment the owner needs it (to configure their
// receiving endpoint's signature check).
function serialize(rule: { id: string; name: string; triggerType: string; triggerConfig: string; actionType: string; actionConfig: string; active: boolean; createdAt: Date }) {
  const actionConfig = JSON.parse(rule.actionConfig)
  if (rule.actionType === 'call_webhook') delete actionConfig.signingSecretEnc

  return {
    id: rule.id,
    name: rule.name,
    triggerType: rule.triggerType,
    triggerConfig: JSON.parse(rule.triggerConfig),
    actionType: rule.actionType,
    actionConfig,
    active: rule.active,
    createdAt: rule.createdAt,
  }
}

export async function GET() {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  const rules = await prisma.workflowRule.findMany({
    where: { orgId: user.orgId, ownerId: user.id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ rules: rules.map(serialize) })
}

export async function POST(req: Request) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body

  const name = String(body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!TRIGGER_TYPES.includes(body.triggerType)) {
    return NextResponse.json({ error: `triggerType must be one of: ${TRIGGER_TYPES.join(', ')}` }, { status: 400 })
  }
  if (!ACTION_TYPES.includes(body.actionType)) {
    return NextResponse.json({ error: `actionType must be one of: ${ACTION_TYPES.join(', ')}` }, { status: 400 })
  }
  if (typeof body.triggerConfig !== 'object' || typeof body.actionConfig !== 'object') {
    return NextResponse.json({ error: 'triggerConfig and actionConfig must be objects' }, { status: 400 })
  }

  let actionConfig = body.actionConfig
  let signingSecret: string | undefined

  if (body.actionType === 'call_webhook') {
    // A webhook makes the server fetch an attacker-chosen URL — unlike
    // create_task/send_email (which only touch this org's own data), that's
    // a real SSRF surface, so it's admin-only, same gate as the other
    // org-level integrations (org-email, org-sheet-connector).
    if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const url = String(actionConfig.url ?? '').trim()
    try {
      await assertSafeWebhookUrl(url)
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'actionConfig.url is not allowed' }, { status: 400 })
    }
    // The signing secret is always server-generated, never client-supplied
    // — same reasoning as every other API-key-shaped secret in this app
    // (lib/crypto.ts's callers). actionConfig.signingSecretEnc from the
    // client, if present, is ignored.
    signingSecret = generateRandomToken(24)
    actionConfig = { url, signingSecretEnc: encrypt(signingSecret) }
  }

  const rule = await prisma.workflowRule.create({
    data: {
      orgId: user.orgId,
      name,
      triggerType: body.triggerType,
      triggerConfig: JSON.stringify(body.triggerConfig),
      actionType: body.actionType,
      actionConfig: JSON.stringify(actionConfig),
      ownerId: user.id,
    },
  })
  return NextResponse.json({ rule: serialize(rule), signingSecret })
}
