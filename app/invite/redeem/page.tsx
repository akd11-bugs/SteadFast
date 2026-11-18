import Link from 'next/link'
import { neonAuth } from '@/lib/auth'
import { AuthShell } from '@/components/auth/AuthShell'
import { RedeemInviteForm } from '@/components/auth/RedeemInviteForm'
import { BRAND_NAME } from '@/lib/branding'

export const dynamic = 'force-dynamic'

export default async function RedeemInvitePage() {
  const { data } = await neonAuth.getSession()
  const alreadySignedInEmail = data?.user?.email?.trim().toLowerCase() || null

  return (
    <AuthShell
      title={`Join ${BRAND_NAME}`}
      subtitle={
        alreadySignedInEmail
          ? 'Enter the invite code your admin gave you to join their workspace.'
          : 'Enter the invite code your admin gave you, and set your login details.'
      }
      quote={{ line: 'Your team is already here. One link and you’re in.', attribution: BRAND_NAME }}
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-white underline underline-offset-4">
            Log in
          </Link>
          {' '}then open the link again.
        </>
      }
    >
      <RedeemInviteForm alreadySignedInEmail={alreadySignedInEmail} />
    </AuthShell>
  )
}
