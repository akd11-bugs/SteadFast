import { NextResponse } from 'next/server'
import { neonAuth } from '@/lib/auth'
import { requireApiUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

// Sends the logged-in user a "set your password" email via Neon Auth's own
// reset-password flow — the same mechanism as a forgotten-password request,
// just not framed that way to the user. That's deliberate: a Google-only
// account has no existing password, so there's nothing for changePassword()
// (which requires currentPassword) to check against. requestPasswordReset
// works the same whether a password already exists or not, which is exactly
// "set" for a first-time password and "change" for an existing one — one
// endpoint covers both without the route needing to know which case it is.
export async function POST(req: Request) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user

  const origin = new URL(req.url).origin
  const { error } = await neonAuth.requestPasswordReset({
    email: user.email,
    redirectTo: `${origin}/reset-password`,
  })
  if (error) {
    return NextResponse.json({ error: error.message || 'Could not send the reset email — try again.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
