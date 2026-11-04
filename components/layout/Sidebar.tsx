'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  LayoutDashboard,
  KanbanSquare,
  Building2,
  Users,
  Sparkles,
  Settings,
  Github,
  ListChecks,
  ClipboardCheck,
  BarChart3,
  CalendarDays,
  PenTool,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionUser } from '@/lib/session'
import { OrgLogo } from '@/components/branding/OrgLogo'

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
  const operations = user.role === 'operations'
  const admin = user.role === 'admin'
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
        {operations ? (
          <NavSection title="Operations" collapsed={collapsed}>
            <NavItem href="/onboarding" icon={<ClipboardCheck className="h-4 w-4" />} collapsed={collapsed}>
              Onboarding queue
            </NavItem>
          </NavSection>
        ) : (
          <>
            <NavSection title="Workspace" collapsed={collapsed}>
              <NavItem href="/" icon={<LayoutDashboard className="h-4 w-4" />} collapsed={collapsed}>
                Dashboard
              </NavItem>
              <NavItem href="/pipeline" icon={<KanbanSquare className="h-4 w-4" />} collapsed={collapsed}>
                Pipeline
              </NavItem>
              <NavItem href="/leads" icon={<Users className="h-4 w-4" />} collapsed={collapsed}>
                Leads
              </NavItem>
              <NavItem href="/companies" icon={<Building2 className="h-4 w-4" />} collapsed={collapsed}>
                Companies
              </NavItem>
              <NavItem href="/tasks" icon={<ListChecks className="h-4 w-4" />} collapsed={collapsed}>
                Tasks
              </NavItem>
              <NavItem href="/whiteboard" icon={<PenTool className="h-4 w-4" />} collapsed={collapsed}>
                Whiteboard
              </NavItem>
              <NavItem href="/calendar" icon={<CalendarDays className="h-4 w-4" />} collapsed={collapsed}>
                Calendar
              </NavItem>
              {admin && (
                <NavItem href="/onboarding" icon={<ClipboardCheck className="h-4 w-4" />} collapsed={collapsed}>
                  Onboarding queue
                </NavItem>
              )}
              {admin && (
                <NavItem href="/reports" icon={<BarChart3 className="h-4 w-4" />} collapsed={collapsed}>
                  Reports
                </NavItem>
              )}
            </NavSection>
            <NavSection title="Services" collapsed={collapsed}>
              <NavItem href="/services" icon={<Sparkles className="h-4 w-4" />} collapsed={collapsed}>
                Services
              </NavItem>
            </NavSection>
          </>
        )}
        <NavSection title="System" collapsed={collapsed}>
          <NavItem href="/settings" icon={<Settings className="h-4 w-4" />} collapsed={collapsed}>
            Settings
          </NavItem>
        </NavSection>
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

function NavSection({ title, collapsed, children }: { title: string; collapsed: boolean; children: React.ReactNode }) {
  if (collapsed) return <div className="py-2 space-y-0.5">{children}</div>
  return (
    <div className="py-2">
      <p className="px-2 mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function NavItem({
  href,
  icon,
  collapsed,
  children,
}: {
  href: string
  icon: React.ReactNode
  collapsed: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      title={collapsed ? String(children) : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-2 py-1.5 text-foreground/80 hover:bg-accent hover:text-foreground transition-colors overflow-hidden',
        collapsed && 'justify-center px-0',
      )}
    >
      {icon}
      {!collapsed && <span className="whitespace-nowrap">{children}</span>}
    </Link>
  )
}