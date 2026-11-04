'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Plus, ScanLine, Building2, User as UserIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { NewLeadDialog } from '@/components/leads/NewLeadDialog'
import { ImportLeadsDialog } from '@/components/leads/ImportLeadsDialog'
import type { SessionUser } from '@/lib/session'
import { OrgLogo } from '@/components/branding/OrgLogo'
import { BRAND_NAME } from '@/lib/branding'
import { ThemeToggle } from '@/components/layout/ThemeToggle'

interface CompanyResult {
  id: string
  name: string
  industry: string | null
  _count: { leads: number; people: number }
}

interface PersonResult {
  id: string
  stage: string
  company: { name: string } | null
  person: { name: string } | null
}

// signOutButton is rendered server-side and passed in as an element — it's a
// Server Component (server action + Prisma import) and can't be imported
// directly into this Client Component without pulling `pg`/Node builtins
// into the browser bundle.
export function TopBar({ user, signOutButton }: { user: SessionUser; signOutButton: React.ReactNode }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [scanDialogOpen, setScanDialogOpen] = useState(false)
  const [companies, setCompanies] = useState<CompanyResult[]>([])
  const [people, setPeople] = useState<PersonResult[]>([])
  const [searching, setSearching] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) {
      setCompanies([])
      setPeople([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(() => {
      Promise.all([
        fetch(`/api/companies?q=${encodeURIComponent(q)}`).then((r) => r.json()),
        fetch(`/api/leads/search?q=${encodeURIComponent(q)}`).then((r) => r.json()),
      ])
        .then(([companyData, leadData]) => {
          setCompanies(companyData.companies ?? [])
          setPeople(leadData.leads ?? [])
        })
        .finally(() => setSearching(false))
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function goToCompany(id: string) {
    setOpen(false)
    setQuery('')
    router.push(`/companies/${id}`)
  }

  function goToLead(id: string) {
    setOpen(false)
    setQuery('')
    router.push(`/leads/${id}`)
  }

  const hasResults = companies.length > 0 || people.length > 0
  const showDropdown = open && query.trim().length >= 2

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 md:px-6 backdrop-blur">
      <div className="md:hidden flex items-center gap-2 font-semibold">
        <OrgLogo org={{ name: BRAND_NAME }} size={20} />
        <span className="text-sm tracking-tight">{BRAND_NAME}</span>
      </div>
      <div className="flex-1 max-w-xl relative" ref={containerRef}>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            placeholder="Search leads, companies, POCs…"
            className="pl-9 pr-14 h-9 bg-muted/40"
            aria-label="Search"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-2 hidden select-none items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:flex">
            ⌘K
          </kbd>
        </div>

        {showDropdown && (
          <div className="absolute left-0 right-0 mt-1.5 rounded-md border bg-popover shadow-lg max-h-96 overflow-y-auto z-30">
            {searching && <p className="px-3 py-3 text-xs text-muted-foreground">Searching…</p>}
            {!searching && !hasResults && <p className="px-3 py-3 text-xs text-muted-foreground">No matches.</p>}

            {!searching && companies.length > 0 && (
              <div className="py-1">
                <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Companies</p>
                {companies.map((c) => (
                  <button
                    key={c.id}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                    onClick={() => goToCompany(c.id)}
                  >
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{c.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground shrink-0">
                      {c._count.leads} lead{c._count.leads === 1 ? '' : 's'}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {!searching && people.length > 0 && (
              <div className="py-1 border-t">
                <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">People</p>
                {people.map((l) => (
                  <button
                    key={l.id}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                    onClick={() => goToLead(l.id)}
                  >
                    <UserIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{l.person?.name ?? 'No contact set'}</span>
                    <span className="text-xs text-muted-foreground truncate">· {l.company?.name ?? 'Unknown company'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {/* Skips the "New Lead" dialog's manual-entry view entirely — opens it
          headlessly, straight into scan mode (see NewLeadDialog's
          autoTriggerScan), for a rep who's already holding a card up to
          their camera and doesn't want to tap through "New Lead" first. */}
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-9 w-9 shrink-0"
        title="Scan a business card"
        aria-label="Scan a business card"
        onClick={() => setScanDialogOpen(true)}
      >
        <ScanLine className="h-4 w-4" />
      </Button>
      <NewLeadDialog open={scanDialogOpen} onOpenChange={setScanDialogOpen} autoTriggerScan />
      <div className="flex items-center gap-2">
        <ImportLeadsDialog />
        <NewLeadDialog>
          <Button size="sm">
            <Plus className="h-4 w-4" />
            New Lead
          </Button>
        </NewLeadDialog>
        <div className="hidden sm:flex items-center gap-1.5 pl-2 ml-1 border-l">
          <span className="text-sm font-medium">{user.name}</span>
          <Badge variant="outline" className="text-[10px] capitalize">
            {user.role}
          </Badge>
        </div>
        <ThemeToggle />
        {signOutButton}
      </div>
    </header>
  )
}
