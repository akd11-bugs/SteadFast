'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

// A domain match now auto-joins instantly in lib/session.ts's
// resolveSession() — this page/component only ever renders for an email
// with no org to join (personal domain, or no one at that company has
// signed up yet), so the only action left is creating a brand-new org.
export function AccountNotFoundActions() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')

  async function createOrg() {
    if (!companyName.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/account-not-found/create-org', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyName: companyName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not create your organization')
        return
      }
      router.push('/')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Create your own company</p>
      <div className="space-y-1.5">
        <Label htmlFor="companyName">Company name</Label>
        <Input id="companyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Inc" autoFocus />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="sm" onClick={createOrg} disabled={busy || !companyName.trim()}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Create company
      </Button>
    </div>
  )
}
