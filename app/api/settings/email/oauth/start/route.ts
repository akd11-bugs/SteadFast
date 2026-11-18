import { NextResponse } from 'next/server'
import { OAuth2Client } from 'google-auth-library'
import { requireApiUser } from '@/lib/session'
import { generateRandomToken } from '@/lib/crypto'
import { GMAIL_OAUTH_STATE_COOKIE } from '@/lib/email'

export const dynamic = 'force-dynamic'

// Reuses the same Google Cloud OAuth client Neon Auth already uses for
// "Sign in with Google" (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET) — the user
// added the gmail.send scope to that same client rather than creating a
// second one. This is a genuinely separate authorization-code exchange
// (different scope, different redirect URI, different token storage) that
// happens to share the same client credentials; it does not touch or
// affect Neon Auth's own sign-in flow or its tokens.
function gmailSendOAuthClient(req: Request): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set')
  }
  const redirectUri = new URL('/api/settings/email/oauth/callback', req.url).toString()
  return new OAuth2Client({ clientId, clientSecret, redirectUri })
}

export async function GET(req: Request) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user

  let client: OAuth2Client
  try {
    client = gmailSendOAuthClient(req)
  } catch {
    // Back to Settings with the card's error banner, not a raw JSON page.
    const settingsUrl = new URL('/settings', req.url)
    settingsUrl.searchParams.set('gmailError', '1')
    return NextResponse.redirect(settingsUrl)
  }

  const state = generateRandomToken(16)

  // offline + consent: Google only returns a refresh token on the first
  // consent, or when prompt=consent forces it — without this, a user who'd
  // previously consented (e.g. via Neon Auth sign-in, same client) could
  // silently get no refresh_token back at all.
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.send', 'openid', 'email'],
    // CSRF guard: a random value that must come back matching the cookie
    // set below. Without it, an attacker could hand a signed-in user a
    // callback link carrying the attacker's own code and bind their Gmail.
    state,
  })

  const res = NextResponse.redirect(authUrl)
  res.cookies.set(GMAIL_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/settings/email/oauth',
    maxAge: 10 * 60,
  })
  return res
}
