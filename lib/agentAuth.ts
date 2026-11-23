import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { checkRateLimit, getClientIp, peekRateLimit } from '@/lib/rateLimit'

export interface AgentOrg {
  orgId: string
}

// Two separate limits, because they defend against different things.
//
// UNAUTH is per-IP and tight: only requests without a valid key burn from
// it, so sweeping the keyspace from one host dies quickly. AUTH is
// per-org and generous — agents retry and poll far harder than humans, and an
// MCP client can legitimately fan out several calls per user turn — but it
// still bounds what a single leaked key can do to the database.
const UNAUTH_MAX = 20
const UNAUTH_WINDOW_MS = 5 * 60 * 1000
const AUTH_MAX = 600
const AUTH_WINDOW_MS = 60 * 1000

function tooMany(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: 'Too many requests' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  )
}

// Cross-domain, unattended caller — same "the key IS the org scope" pattern
// as app/api/external/reports/route.ts, extended to write actions. No
// browser session, no SessionUser: an agent isn't any one human, so callers
// get just the orgId, and attribute activity/stage-change notes to a fixed
// actor name (see ACTOR) rather than a real user.
//
// The key is looked up with findUnique on a @unique column, so the comparison
// happens inside Postgres on an index rather than in JS — there's no
// byte-at-a-time timing signal for an attacker to walk, which is what
// safeEqual() exists to prevent for keys compared in application code.
export async function requireAgentOrg(req: Request): Promise<AgentOrg | NextResponse> {
  const ip = getClientIp(req)

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    const unauth = checkRateLimit(`agent-unauth:${ip}`, UNAUTH_MAX, UNAUTH_WINDOW_MS)
    if (!unauth.allowed) return tooMany(unauth.retryAfterSeconds)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Peek at the per-IP budget before touching the database, so an invalid-key
  // flood can't make us run a query per attempt. Only a failed lookup spends
  // it: charging valid calls here capped every real agent at 20 per 5 min
  // (and shared that cap across orgs behind one egress IP).
  const unauth = peekRateLimit(`agent-unauth:${ip}`, UNAUTH_MAX)
  if (!unauth.allowed) return tooMany(unauth.retryAfterSeconds)

  const org = await prisma.organization.findUnique({ where: { agentApiKey: token }, select: { id: true } })
  if (!org) {
    checkRateLimit(`agent-unauth:${ip}`, UNAUTH_MAX, UNAUTH_WINDOW_MS)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authed = checkRateLimit(`agent-org:${org.id}`, AUTH_MAX, AUTH_WINDOW_MS)
  if (!authed.allowed) return tooMany(authed.retryAfterSeconds)

  return { orgId: org.id }
}

// Attributed in activity descriptions and stage-change actor fields exactly
// the way a human's name would be — so it's visible in the lead's timeline
// which changes came from the agent API versus a person, never disguised as
// one of the org's real users.
export const AGENT_ACTOR_NAME = 'AI Agent'
