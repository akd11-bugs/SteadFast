import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sendEmailAs } from '@/lib/email'
import { requireApiUser, leadScope } from '@/lib/session'
import { readJsonBody } from '@/lib/http'
import { isValidEmail } from '@/lib/types'
import { checkRateLimit } from '@/lib/rateLimit'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const SUBJECT_MAX = 300
const BODY_MAX = 20000

export async function POST(req: Request) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user

  // Per-user, not per-IP — this is the meaningful boundary for "one account
  // can't turn our SMTP credentials into a spam relay," and keeps a shared
  // office IP from throttling everyone else.
  const rateLimit = checkRateLimit(`email-send:${user.id}`, 20, 60 * 60 * 1000)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many emails sent — try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body
  const { leadId, to, subject, body: emailBody } = body

  if (!subject || !emailBody) {
    return NextResponse.json({ error: 'subject and body are required' }, { status: 400 })
  }
  if (typeof subject !== 'string' || subject.length > SUBJECT_MAX) {
    return NextResponse.json({ error: `subject must be ${SUBJECT_MAX} characters or fewer` }, { status: 400 })
  }
  if (typeof emailBody !== 'string' || emailBody.length > BODY_MAX) {
    return NextResponse.json({ error: `body must be ${BODY_MAX} characters or fewer` }, { status: 400 })
  }
  if (!leadId && !to) {
    return NextResponse.json({ error: 'Provide either leadId or a custom "to" address' }, { status: 400 })
  }

  // Lead-scoped send: look up the address, log it as an Activity on that lead.
  if (leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, ...leadScope(user) } })
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }
    if (!lead.email) {
      return NextResponse.json({ error: 'This lead has no email address — add one first' }, { status: 400 })
    }
    let result
    try {
      result = await sendEmailAs(user.id, { to: lead.email, subject, body: emailBody })
    } catch (err) {
      console.error('sendEmail (lead-scoped) failed', err)
      return NextResponse.json({ error: 'Could not send the email — please try again shortly' }, { status: 502 })
    }
    // The email is out. A logging failure from here on must not say "try again",
    // or the user re-sends and the lead gets the same email twice.
    try {
      const activity = await prisma.activity.create({
        data: {
          orgId: lead.orgId,
          leadId,
          type: 'email',
          description: `Sent: "${subject}"\n\n${emailBody}`,
          authorName: user.name,
        },
      })
      await prisma.lead.update({ where: { id: leadId }, data: { lastActivityAt: activity.date } })

      return NextResponse.json({ ok: true, emailId: result.id, activity })
    } catch (err) {
      console.error('sendEmail sent but activity logging failed', err)
      return NextResponse.json({ ok: true, emailId: result.id, activity: null, warning: 'Email sent, but it could not be logged on the lead' })
    }
  }

  // Custom recipient — not a lead in the system, so there's nothing to log an
  // Activity against. This is the one path that can reach an arbitrary
  // external address, so it gets its own validation and an audit trail.
  if (typeof to !== 'string' || !isValidEmail(to)) {
    return NextResponse.json({ error: 'A valid "to" address is required' }, { status: 400 })
  }
  // The per-user limit above bounds one account's abuse, but doesn't bound
  // the org's aggregate reputation exposure as headcount grows (N users each
  // get their own 20/hour budget). This org-scoped cap is the backstop.
  const orgRateLimit = checkRateLimit(`email-send-org:${user.orgId}`, 200, 60 * 60 * 1000)
  if (!orgRateLimit.allowed) {
    return NextResponse.json(
      { error: 'This organization has reached its hourly email sending limit — try again later' },
      { status: 429, headers: { 'Retry-After': String(orgRateLimit.retryAfterSeconds) } },
    )
  }
  try {
    const result = await sendEmailAs(user.id, { to, subject, body: emailBody })
    await logAudit({ action: 'custom_email_sent', actorUserId: user.id, metadata: { to } })
    return NextResponse.json({ ok: true, emailId: result.id })
  } catch (err) {
    console.error('sendEmail (custom recipient) failed', err)
    return NextResponse.json({ error: 'Could not send the email — please try again shortly' }, { status: 502 })
  }
}
