'use client'

import { usePathname } from 'next/navigation'
import { Sidebar, useSidebarCollapsed } from './Sidebar'
import { TopBar } from './TopBar'
import { CommandPalette } from './CommandPalette'
import { cn } from '@/lib/utils'
import type { SessionUser } from '@/lib/session'

// The login page renders standalone — no nav shell around a sign-in form.
// /rep and /rep/<slug> are the separate PIN-authenticated rep form, and
// /intake/<slug> is the public lead-capture form — neither must ever show
// the dashboard shell, even for someone who also happens to be logged into
// the dashboard in the same browser (an admin testing one of these, for
// instance). Must be startsWith, not an exact match — an exact match on
// '/rep' alone would miss every per-org '/rep/<slug>' page.
export function AppShell({
  user,
  signOutButton,
  children,
}: {
  user: SessionUser | null
  signOutButton: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isStandalonePage =
    pathname === '/login' || pathname === '/invite/redeem' || pathname === '/rep' || pathname.startsWith('/rep/') || pathname.startsWith('/intake/')
  // Hook must run before the standalone-page early return (rules of hooks) —
  // its result is simply unused for those pages, which never render Sidebar.
  const collapsed = useSidebarCollapsed()
  if (isStandalonePage || !user) {
    return <>{children}</>
  }
  return (
    <div className="min-h-screen">
      <CommandPalette user={user} />
      <Sidebar user={user} />
      <div className={cn('transition-[padding] duration-150', collapsed ? 'md:pl-16' : 'md:pl-60')}>
        <TopBar user={user} signOutButton={signOutButton} />
        <main className="px-4 md:px-6 py-6 max-w-[1600px] mx-auto">{children}</main>
      </div>
    </div>
  )
}
