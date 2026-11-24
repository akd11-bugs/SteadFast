'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Building2 } from 'lucide-react'

interface CompanyResult {
  id: string
  name: string
  industry: string | null
}

// Plain text input, same wire contract as before (a name string the server
// find-or-creates — see app/api/leads/route.ts) — this only adds a
// suggestions dropdown on top so picking an existing company doesn't mean
// retyping it slightly differently and accidentally creating a near-dupe.
export function CompanyPicker({
  id,
  value,
  onChange,
}: {
  id?: string
  value: string
  onChange: (name: string) => void
}) {
  const [results, setResults] = useState<CompanyResult[]>([])
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = value.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    let stale = false // an older, slower search must not overwrite newer results
    debounceRef.current = setTimeout(() => {
      fetch(`/api/companies?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => { if (!stale) setResults(data.companies ?? []) })
        .catch(() => { if (!stale) setResults([]) })
    }, 250)
    return () => {
      stale = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // An exact (case-insensitive) match means this name already resolves to one
  // specific existing company — nothing worth suggesting beyond that.
  const showDropdown = open && results.length > 0 && !results.some((r) => r.name.toLowerCase() === value.trim().toLowerCase())

  return (
    <div className="relative" ref={containerRef}>
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {showDropdown && (
        <div className="absolute left-0 right-0 mt-1 rounded-md border bg-popover shadow-lg max-h-48 overflow-y-auto z-30">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
              onClick={() => {
                onChange(c.name)
                setOpen(false)
              }}
            >
              <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{c.name}</span>
              {c.industry && <span className="ml-auto text-xs text-muted-foreground shrink-0">{c.industry}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
