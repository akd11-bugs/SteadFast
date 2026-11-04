import { NextResponse } from 'next/server'
import { neonAuth } from '@/lib/auth'
import { readJsonBody } from '@/lib/http'

export const dynamic = 'force-dynamic'

// Public and unauthenticated by design — the token in the body (from the
// emailed link, see app/reset-password/page.tsx) is what proves identity
// here, the same as any password-reset confirmation step. Not under
// /api/settings/* because this isn't a settings change by a logged-in
// session; it's Neon Auth's generic reset-password completion.
export async function POST(req: Request) {
  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body

  const token = String(body.token ?? '')
  const newPassword = String(body.newPassword ?? '')
  if (!token || newPassword.length < 8) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const { error } = await neonAuth.resetPassword({ token, newPassword })
  if (error) {
    return NextResponse.json(
      { error: error.message || 'Could not reset your password — the link may have expired.' },
      { status: 400 },
    )
  }
  return NextResponse.json({ ok: true })
}
