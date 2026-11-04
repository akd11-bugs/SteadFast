import { neonAuth } from '@/lib/auth'
import { RedeemInviteForm } from '@/components/auth/RedeemInviteForm'

export const dynamic = 'force-dynamic'

export default async function RedeemInvitePage() {
  const { data } = await neonAuth.getSession()
  const alreadySignedInEmail = data?.user?.email?.trim().toLowerCase() || null

  return <RedeemInviteForm alreadySignedInEmail={alreadySignedInEmail} />
}
