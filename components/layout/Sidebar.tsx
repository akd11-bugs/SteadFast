'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Github, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionUser } from '@/lib/session'
import { OrgLogo } from '@/components/branding/OrgLogo'
import { SidebarNavContent } from './SidebarNavContent'

// Per-browser UI preference, not tenant data — localStorage is the right
// home for it (no existing convention for this in the app; first use).
// AppShell reads the same key (via useSidebarCollapsed) to size its own
// left padding to match, so the two never drift out of sync.
const STORAGE_KEY = 'steadfast:sidebar-collapsed'

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      // Private browsing / blocked storage — default (expanded) is fine.
    }
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setCollapsed(e.newValue === '1')
    }
    // Keeps AppShell's padding and the sidebar's own width in sync even
    // across two tabs of the same browser, not just within one render tree.
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return collapsed
}

function setSidebarCollapsed(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    // Ignore — the toggle still works for this tab's own state this session.
  }
  window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: value ? '1' : '0' }))
}

export function Sidebar({ user }: { user: SessionUser }) {
  const collapsed = useSidebarCollapsed()

  return (
    <aside
      className={cn(
        'hidden md:flex md:flex-col md:fixed md:inset-y-0 z-30 border-r bg-muted/30 transition-[width] duration-150',
        collapsed ? 'md:w-16' : 'md:w-60',
      )}
    >
      <div className="flex h-14 items-center justify-between border-b px-4">
        <Link href="/" className={cn('flex items-center gap-2 font-semibold overflow-hidden', collapsed && 'gap-0')}>
          <OrgLogo org={{ name: user.orgName, logoUrl: user.orgLogoUrl, logoDataUrl: user.orgLogoDataUrl }} size={24} />
          {!collapsed && <span className="text-base tracking-tight whitespace-nowrap">{user.orgName}</span>}
        </Link>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4 text-sm overflow-x-hidden">
        <SidebarNavContent user={user} collapsed={collapsed} />
      </nav>
      <div className="border-t p-3 text-xs text-muted-foreground">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className="flex w-full items-center justify-center rounded-md py-1 hover:bg-accent hover:text-foreground"
            title="Expand sidebar"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
              <Github className="h-3 w-3 shrink-0" />
              <span>30 skills · hybrid runner</span>
            </div>
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              className="shrink-0 rounded-md p-1 hover:bg-accent hover:text-foreground"
              title="Collapse sidebar"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}