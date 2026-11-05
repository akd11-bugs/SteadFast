'use server'

import { redirect } from 'next/navigation'
import { neonAuth } from '@/lib/auth'

// Lets someone on the invite-redeem form back out of a stale/wrong Google
// session (see RedeemInviteForm's comment) without leaving the invite page —
// signs out, then lands back on the same code so she can sign in as the
// right person and retry.
export async function signOutForInviteRetry(code: string) {
  await neonAuth.signOut()
  redirect(`/invite/redeem${code ? `?code=${encodeURIComponent(code)}` : ''}`)
}
