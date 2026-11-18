import { NextResponse, type NextRequest } from 'next/server'
import { OAuth2Client } from 'google-auth-library'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/session'
import { encrypt } from '@/lib/crypto'
import { GMAIL_OAUTH_STATE_COOKIE } from '@/lib/email'

export const dynamic = 'force-dynamic'

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

export async function GET(req: NextRequest) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expectedState = req.cookies.get(GMAIL_OAUTH_STATE_COOKIE)?.value
  const settingsUrl = new URL('/settings', req.url)

  // Every exit clears the one-time state cookie.
  const done = (param: 'gmailConnected' | 'gmailError') => {
    settingsUrl.searchParams.set(param, '1')
    const res = NextResponse.redirect(settingsUrl)
    res.cookies.delete({ name: GMAIL_OAUTH_STATE_COOKIE, path: '/api/settings/email/oauth' })
    return res
  }

  // CSRF: only a flow this browser started (start route set the cookie) may
  // finish. A forged callback link carrying someone else's code fails here.
  if (!state || !expectedState || state !== expectedState) return done('gmailError')
  if (url.searchParams.get('error') || !code) return done('gmailError')

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return done('gmailError')

  const redirectUri = new URL('/api/settings/email/oauth/callback', req.url).toString()
  const client = new OAuth2Client({ clientId, clientSecret, redirectUri })

  try {
    const { tokens } = await client.getToken(code)
    // Google's consent screen lets the user untick "send email"; without
    // that scope every send would fail while Settings says "connected".
    if (!tokens.refresh_token || !tokens.id_token || !tokens.scope?.split(' ').includes(GMAIL_SEND_SCOPE)) {
      return done('gmailError')
    }

    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId })
    const email = ticket.getPayload()?.email
    if (!email) return done('gmailError')

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailFromAddress: email,
        gmailRefreshTokenEnc: encrypt(tokens.refresh_token),
        emailConfiguredAt: new Date(),
      },
    })
    return done('gmailConnected')
  } catch (err) {
    console.error('settings/email/oauth/callback: token exchange failed', err)
    return done('gmailError')
  }
}
