import nodemailer from 'nodemailer'
import { OAuth2Client } from 'google-auth-library'
import { prisma } from '@/lib/db'
import { tryDecrypt } from '@/lib/crypto'

// Cookie holding the one-time `state` for the Gmail connect flow
// (app/api/settings/email/oauth/start and /callback).
export const GMAIL_OAUTH_STATE_COOKIE = 'gmail_oauth_state'

export interface SendEmailInput {
  to: string
  subject: string
  body: string
}

export interface SendEmailResult {
  id: string
}

interface Mailbox {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
}

// Shared by send() below and the org-email settings route's credential
// verification step (app/api/settings/org-email/route.ts) — one place for
// the transporter shape and timeouts. A transporter is cheap to build (no
// connection pooling needed at this scale — see lib/skills/runner.ts's
// dispatch pattern), so one is built fresh per send rather than cached per
// org/user: a cache would keep serving a stale password after someone
// rotates their credentials from Settings, until the process restarted.
export function createMailboxTransporter(opts: { host: string; port: number; secure: boolean; user: string; pass?: string }) {
  return nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.secure,
    auth: { user: opts.user, pass: opts.pass },
    // A slow response or a blocked outbound port otherwise hangs for
    // nodemailer's default (up to 10 min), well past any serverless
    // function timeout.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  })
}

async function send(mailbox: Mailbox, input: SendEmailInput): Promise<SendEmailResult> {
  const transporter = createMailboxTransporter(mailbox)
  const info = await transporter.sendMail({ from: mailbox.from, to: input.to, subject: input.subject, text: input.body })
  return { id: info.messageId }
}

function globalMailbox(): Mailbox {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error(
      'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS in .env, or configure an org mailbox from Settings, to send email.'
    )
  }
  return {
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    user: SMTP_USER,
    pass: SMTP_PASS,
    from: EMAIL_FROM || SMTP_USER,
  }
}

async function orgMailbox(orgId: string): Promise<Mailbox | null> {
  const config = await prisma.orgEmailConfig.findUnique({ where: { orgId } })
  if (!config) return null
  const pass = tryDecrypt(config.smtpPassEnc)
  if (!pass) return null
  return {
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    user: config.smtpUser,
    pass,
    from: config.fromName ? `${config.fromName} <${config.fromAddress}>` : config.fromAddress,
  }
}

/**
 * Sends from the given org's own configured SMTP mailbox, if one is set —
 * falls back to the shared global mailbox (env-configured) otherwise, or if
 * the stored credential fails to decrypt (e.g. key rotated). Pass no orgId
 * to go straight to the global mailbox (e.g. pre-account signup emails,
 * which have no org yet).
 */
export async function sendEmail(input: SendEmailInput, orgId?: string): Promise<SendEmailResult> {
  const mailbox = (orgId ? await orgMailbox(orgId) : null) ?? globalMailbox()
  return send(mailbox, input)
}

// base64url, no padding — Gmail API's `raw` field requires this exact
// encoding, not plain base64 (which uses +/ and = that aren't URL-safe).
function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// MIME headers need encoded-word escaping for any non-ASCII subject; this
// app's subjects/bodies are plain operator-authored text (workflow rule
// config, not user-supplied HTML), so a minimal RFC 2822 message is enough.
// shortcut: per-process cache, never evicted except on a failed refresh; fine
// at tens of connected users, add an LRU if that grows to thousands.
const gmailClients = new Map<string, OAuth2Client>()

// A CR or LF inside a header value would start a new header (e.g. an
// injected "Bcc:"), so header values are flattened to one line. The subject
// is RFC 2047 encoded, which also keeps non-ASCII subjects readable.
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ')

function buildRawMessage(from: string, input: SendEmailInput): string {
  const subject = `=?UTF-8?B?${Buffer.from(oneLine(input.subject), 'utf8').toString('base64')}?=`
  const headers = [`From: ${oneLine(from)}`, `To: ${oneLine(input.to)}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset="UTF-8"']
  return toBase64Url(`${headers.join('\r\n')}\r\n\r\n${input.body}`)
}

/**
 * Sends via the Gmail API (OAuth), as the given user's own connected Gmail
 * account, if they have one — falls back to their org's mailbox, then the
 * global shared mailbox, if they don't, or if the stored refresh token
 * fails to decrypt (e.g. key rotated) or Google rejects it (e.g. access
 * revoked). Not SMTP: Render's free tier blocks outbound SMTP entirely
 * (confirmed via live ETIMEDOUT connection failures on both ports 465 and
 * 587), so this sends over HTTPS instead, which isn't subject to that block.
 */
export async function sendEmailAs(userId: string, input: SendEmailInput): Promise<SendEmailResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgId: true, emailFromAddress: true, gmailRefreshTokenEnc: true },
  })

  const refreshToken = user?.gmailRefreshTokenEnc ? tryDecrypt(user.gmailRefreshTokenEnc) : null
  if (!user?.emailFromAddress || !refreshToken) {
    return sendEmail(input, user?.orgId)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return sendEmail(input, user.orgId)
  }

  // One client per refresh token: it caches the access token until expiry
  // and shares an in-flight refresh, so a bulk stage change doesn't fire one
  // token refresh per lead. Keyed by the token, so a reconnect misses.
  let client = gmailClients.get(refreshToken)
  if (!client) {
    client = new OAuth2Client({ clientId, clientSecret })
    client.setCredentials({ refresh_token: refreshToken })
    gmailClients.set(refreshToken, client)
  }

  let accessToken: string | null | undefined
  try {
    accessToken = (await client.getAccessToken()).token
  } catch (err) {
    gmailClients.delete(refreshToken)
    console.error('[email] Gmail token refresh failed', userId, err)
    // Revoked or expired for good: clear the connection so Settings shows
    // "not connected" and the user reconnects, instead of failing forever.
    if (String(err).includes('invalid_grant')) {
      await prisma.user
        .update({ where: { id: userId }, data: { gmailRefreshTokenEnc: null, emailConfiguredAt: null } })
        .catch(() => undefined)
    }
    return sendEmail(input, user.orgId)
  }
  if (!accessToken) return sendEmail(input, user.orgId)

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: buildRawMessage(user.emailFromAddress, input) }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new Error(`Gmail API send failed: ${res.status} ${await res.text().catch(() => '')}`)
  }
  const data = (await res.json()) as { id: string }
  return { id: data.id }
}
