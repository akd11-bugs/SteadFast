import { redirect } from 'next/navigation'
import { neonAuth } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { SignOutButton } from '@/components/layout/SignOutButton'
import { AccountNotFoundActions } from '@/components/auth/AccountNotFoundActions'
import { UserX } from 'lucide-react'

export const dynamic = 'force-dynamic'

// Landed on by requireUser()/requireAnyUser() when a Neon Auth identity has
// no matching Steadfast User row AND no domain-matched org to auto-join
// (see autoJoinByEmailDomain in lib/session.ts — a domain match never
// reaches this page at all, she's already in by the time resolveSession()
// runs). What's left here is a personal-email domain or a domain with no
// registered org yet, so the only real option is creating a brand-new org —
// no separate signup-link step needed since Google already proved this
// person owns this email address.
export default async function AccountNotFoundPage() {
  const { data } = await neonAuth.getSession()
  if (!data?.user?.email) redirect('/login')

  const email = data.user.email.trim().toLowerCase()

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center space-y-2">
          <div className="h-10 w-10 rounded-full bg-muted grid place-items-center">
            <UserX className="h-5 w-5 text-muted-foreground" />
          </div>
          <CardTitle className="text-xl">No account found</CardTitle>
          <CardDescription>There&apos;s no Steadfast account for {email} yet.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AccountNotFoundActions />
          <div className="flex justify-center border-t pt-3">
            <SignOutButton />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
