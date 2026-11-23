'use client'

import Link from 'next/link'
import {
  LayoutDashboard,
  KanbanSquare,
  Building2,
  Users,
  Sparkles,
  Settings,
  ListChecks,
  ClipboardCheck,
  BarChart3,
  CalendarDays,
  PenTool,
  Database,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionUser } from '@/lib/session'

// Single source for the app's primary nav, rendered by both the desktop
// Sidebar and the mobile drawer (MobileNav) so the two lists can't drift.
export function SidebarNavContent({
  user,
  collapsed = false,
  touch = false,
  onNavigate,
}: {
  user: SessionUser
  collapsed?: boolean
  // Larger rows for the mobile drawer — 40px+ tap targets.
  touch?: boolean
  onNavigate?: () => void
}) {
  const operations = user.role === 'operations'
  const admin = user.role === 'admin'
  const item = { collapsed, touch, onNavigate }

  return (
    <>
      {operations ? (
        <NavSection title="Operations" collapsed={collapsed}>
          <NavItem href="/onboarding" icon={<ClipboardCheck className="h-4 w-4" />} {...item}>
            Onboarding queue
          </NavItem>
        </NavSection>
      ) : (
        <>
          <NavSection title="Workspace" collapsed={collapsed}>
            <NavItem href="/" icon={<LayoutDashboard className="h-4 w-4" />} {...item}>
              Dashboard
            </NavItem>
            <NavItem href="/pipeline" icon={<KanbanSquare className="h-4 w-4" />} {...item}>
              Pipeline
            </NavItem>
            <NavItem href="/leads" icon={<Users className="h-4 w-4" />} {...item}>
              Leads
            </NavItem>
            <NavItem href="/companies" icon={<Building2 className="h-4 w-4" />} {...item}>
              Companies
            </NavItem>
            <NavItem href="/tasks" icon={<ListChecks className="h-4 w-4" />} {...item}>
              Tasks
            </NavItem>
            <NavItem href="/whiteboard" icon={<PenTool className="h-4 w-4" />} {...item}>
              Whiteboard
            </NavItem>
            <NavItem href="/calendar" icon={<CalendarDays className="h-4 w-4" />} {...item}>
              Calendar
            </NavItem>
            {admin && (
              <NavItem href="/onboarding" icon={<ClipboardCheck className="h-4 w-4" />} {...item}>
                Onboarding queue
              </NavItem>
            )}
            {admin && (
              <NavItem href="/reports" icon={<BarChart3 className="h-4 w-4" />} {...item}>
                Reports
              </NavItem>
            )}
          </NavSection>
          <NavSection title="Services" collapsed={collapsed}>
            <NavItem href="/services" icon={<Sparkles className="h-4 w-4" />} {...item}>
              Services
            </NavItem>
          </NavSection>
        </>
      )}
      {/* Outside the role branch so operations users see it too. */}
      {user.recordEngineEnabled && (
        <NavSection title="Data" collapsed={collapsed}>
          <NavItem href="/records" icon={<Database className="h-4 w-4" />} {...item}>
            Records
          </NavItem>
        </NavSection>
      )}
      <NavSection title="System" collapsed={collapsed}>
        <NavItem href="/settings" icon={<Settings className="h-4 w-4" />} {...item}>
          Settings
        </NavItem>
      </NavSection>
    </>
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
  touch,
  onNavigate,
  children,
}: {
  href: string
  icon: React.ReactNode
  collapsed: boolean
  touch: boolean
  onNavigate?: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? String(children) : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-2 py-1.5 text-foreground/80 hover:bg-accent hover:text-foreground transition-colors overflow-hidden',
        touch && 'py-2.5 text-base',
        collapsed && 'justify-center px-0',
      )}
    >
      {icon}
      {!collapsed && <span className="whitespace-nowrap">{children}</span>}
    </Link>
  )
}
