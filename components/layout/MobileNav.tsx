'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { OrgLogo } from '@/components/branding/OrgLogo'
import { ImportLeadsDialog } from '@/components/leads/ImportLeadsDialog'
import type { SessionUser } from '@/lib/session'
import { SidebarNavContent } from './SidebarNavContent'
import { ThemeToggle } from './ThemeToggle'

// The desktop Sidebar is hidden below md. This drawer is the phone-width
// replacement, and also hosts the TopBar actions that don't fit at 375px
// (CSV import, theme, sign out).
export function MobileNav({ user, signOutButton }: { user: SessionUser; signOutButton: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 md:hidden" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-[280px] flex-col gap-0 p-0">
        <div className="flex h-14 items-center gap-2 border-b px-4 pr-12">
          <OrgLogo org={{ name: user.orgName, logoUrl: user.orgLogoUrl, logoDataUrl: user.orgLogoDataUrl }} size={24} />
          <SheetTitle className="truncate text-base font-semibold tracking-tight">{user.orgName}</SheetTitle>
        </div>
        <SheetDescription className="sr-only">Main navigation</SheetDescription>
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <SidebarNavContent user={user} touch onNavigate={() => setOpen(false)} />
        </nav>
        <div className="space-y-3 border-t p-4">
          <ImportLeadsDialog />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-medium">{user.name}</span>
              <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                {user.role}
              </Badge>
            </div>
            <div className="flex shrink-0 items-center">
              <ThemeToggle />
              {signOutButton}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
