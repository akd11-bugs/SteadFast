'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NewLeadDialog } from '@/components/leads/NewLeadDialog'
import { SKILLS } from '@/lib/skills/catalog'
import {
  Search,
  LayoutDashboard,
  KanbanSquare,
  Building2,
  Users,
  ListChecks,
  CalendarDays,
  BarChart3,
  Settings,
  Sparkles,
  ClipboardCheck,
  Plus,
  User as UserIcon,
  type LucideIcon,
} from 'lucide-react'
import type { SessionUser } from '@/lib/session'

interface NavCommand {
  kind: 'nav'
  id: string
  label: string
  icon: LucideIcon
  href: string
}

interface ActionCommand {
  kind: 'action'
  id: string
  label: string
  icon: LucideIcon
  run: () => void
}

type StaticCommand = NavCommand | ActionCommand

interface CompanyResult {
  id: string
  name: string
}

interface LeadResult {
  id: string
  company: { name: string } | null
  person: { name: string } | null
}

// Cmd/Ctrl+K from anywhere in the app shell. Reuses the same
// /api/companies and /api/leads/search endpoints TopBar's typeahead already
// calls — no new search backend, just a second, keyboard-first entry point
// that also knows how to *do* things (navigate, create a lead, jump into a
// skill), not just find records.
export function CommandPalette({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [companies, setCompanies] = useState<CompanyResult[]>([])
  const [leads, setLeads] = useState<LeadResult[]>([])
  const [createLeadOpen, setCreateLeadOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setCompanies([])
      setLeads([])
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) {
      setCompanies([])
      setLeads([])
      return
    }
    let stale = false // an older, slower search must not overwrite newer results
    debounceRef.current = setTimeout(() => {
      Promise.all([
        fetch(`/api/companies?q=${encodeURIComponent(q)}`).then((r) => r.json()),
        fetch(`/api/leads/search?q=${encodeURIComponent(q)}`).then((r) => r.json()),
      ]).then(([companyData, leadData]) => {
        if (stale) return
        setCompanies(companyData.companies ?? [])
        setLeads(leadData.leads ?? [])
      }).catch(() => {})
    }, 250)
    return () => {
      stale = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  const staticCommands: StaticCommand[] = useMemo(() => {
    const operations = user.role === 'operations'
    const admin = user.role === 'admin'
    const nav: NavCommand[] = operations
      ? [{ kind: 'nav', id: 'nav-onboarding', label: 'Onboarding queue', icon: ClipboardCheck, href: '/onboarding' }]
      : [
          { kind: 'nav', id: 'nav-dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
          { kind: 'nav', id: 'nav-pipeline', label: 'Pipeline', icon: KanbanSquare, href: '/pipeline' },
          { kind: 'nav', id: 'nav-leads', label: 'Leads', icon: Users, href: '/leads' },
          { kind: 'nav', id: 'nav-companies', label: 'Companies', icon: Building2, href: '/companies' },
          { kind: 'nav', id: 'nav-tasks', label: 'Tasks', icon: ListChecks, href: '/tasks' },
          { kind: 'nav', id: 'nav-calendar', label: 'Calendar', icon: CalendarDays, href: '/calendar' },
          ...(admin
            ? ([
                { kind: 'nav', id: 'nav-onboarding-q', label: 'Onboarding queue', icon: ClipboardCheck, href: '/onboarding' },
                { kind: 'nav', id: 'nav-reports', label: 'Reports', icon: BarChart3, href: '/reports' },
              ] as NavCommand[])
            : []),
          { kind: 'nav', id: 'nav-skills', label: 'All Skills', icon: Sparkles, href: '/skills' },
        ]
    nav.push({ kind: 'nav', id: 'nav-settings', label: 'Settings', icon: Settings, href: '/settings' })

    const actions: ActionCommand[] = operations
      ? []
      : [{ kind: 'action', id: 'action-create-lead', label: 'Create lead', icon: Plus, run: () => setCreateLeadOpen(true) }]

    return [...actions, ...nav]
  }, [user.role])

  const q = query.trim().toLowerCase()
  const filteredStatic = q ? staticCommands.filter((c) => c.label.toLowerCase().includes(q)) : staticCommands
  const filteredSkills = q
    ? SKILLS.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)).slice(0, 6)
    : []

  // One flat, keyboard-navigable list: static commands first, then matching
  // skills, then live record search results — in the order they render below.
  const flatItems = [
    ...filteredStatic.map((c) => ({ type: 'static' as const, c })),
    ...filteredSkills.map((s) => ({ type: 'skill' as const, s })),
    ...companies.map((c) => ({ type: 'company' as const, c })),
    ...leads.map((l) => ({ type: 'lead' as const, l })),
  ]

  function runItem(item: (typeof flatItems)[number]) {
    if (item.type === 'static') {
      if (item.c.kind === 'nav') go(item.c.href)
      else {
        item.c.run()
        setOpen(false)
      }
    } else if (item.type === 'skill') go(`/skills/${item.s.id}`)
    else if (item.type === 'company') go(`/companies/${item.c.id}`)
    else go(`/leads/${item.l.id}`)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = flatItems[activeIndex]
      if (item) runItem(item)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden [&>button]:hidden">
          <div className="relative border-b">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Search, or type a command…"
              className="h-11 border-0 pl-9 focus-visible:ring-0 rounded-none"
            />
          </div>
          <div className="max-h-80 overflow-y-auto py-1.5">
            {flatItems.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</p>}

            {flatItems.map((item, i) => {
              const active = i === activeIndex
              if (item.type === 'static') {
                const Icon = item.c.icon
                return (
                  <PaletteRow key={item.c.id} active={active} icon={<Icon className="h-4 w-4" />} onClick={() => runItem(item)}>
                    {item.c.label}
                  </PaletteRow>
                )
              }
              if (item.type === 'skill') {
                return (
                  <PaletteRow key={`skill-${item.s.id}`} active={active} icon={<Sparkles className="h-4 w-4" />} onClick={() => runItem(item)}>
                    Run &ldquo;{item.s.name}&rdquo;
                  </PaletteRow>
                )
              }
              if (item.type === 'company') {
                return (
                  <PaletteRow key={`company-${item.c.id}`} active={active} icon={<Building2 className="h-4 w-4" />} onClick={() => runItem(item)}>
                    {item.c.name}
                  </PaletteRow>
                )
              }
              return (
                <PaletteRow key={`lead-${item.l.id}`} active={active} icon={<UserIcon className="h-4 w-4" />} onClick={() => runItem(item)}>
                  {item.l.person?.name ?? 'No contact set'}
                  <span className="text-muted-foreground"> · {item.l.company?.name ?? 'Unknown company'}</span>
                </PaletteRow>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      <NewLeadDialog open={createLeadOpen} onOpenChange={setCreateLeadOpen} />
    </>
  )
}

function PaletteRow({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${active ? 'bg-accent text-accent-foreground' : ''}`}
      onClick={onClick}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  )
}
