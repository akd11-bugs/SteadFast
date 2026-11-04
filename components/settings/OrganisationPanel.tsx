'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { UserPlus, Loader2, Copy, Ban, Trash2, Check, KeyRound, Link2 } from 'lucide-react'

interface UserRow {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
  createdAt: string
}

interface InviteRow {
  id: string
  name: string | null
  role: string
  code: string
  status: string
  isReusable: boolean
  createdAt: string
}

type Role = 'admin' | 'sales' | 'operations'

const ROLE_LABELS: Record<Role, string> = {
  sales: 'Sales — sees only their own leads',
  admin: 'Admin — sees everything',
  operations: 'Operations — manages the onboarding queue',
}

export function OrganisationPanel({
  initialUsers,
  initialInvites,
  orgSlug,
}: {
  initialUsers: UserRow[]
  initialInvites: InviteRow[]
  // Null until the org is backfilled; the PIN dialog then omits the link
  // rather than showing a broken one.
  orgSlug?: string | null
}) {
  const [users, setUsers] = useState(initialUsers)
  const [invites, setInvites] = useState(initialInvites)
  const [form, setForm] = useState({ name: '', role: 'sales' as Role })
  const [saving, setSaving] = useState(false)
  const [linkSaving, setLinkSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pinTarget, setPinTarget] = useState<UserRow | null>(null)
  const [pinValue, setPinValue] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinSaving, setPinSaving] = useState(false)

  async function generateInvite() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to generate invite')
        return
      }
      setInvites((prev) => [data.invite, ...prev])
      setForm({ name: '', role: 'sales' })
    } finally {
      setSaving(false)
    }
  }

  async function generateInviteLink() {
    setLinkSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: form.role, isReusable: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create invite link')
        return
      }
      setInvites((prev) => [data.invite, ...prev])
    } finally {
      setLinkSaving(false)
    }
  }

  async function revokeInvite(id: string) {
    if (!confirm('Revoke this invite code? It will no longer be redeemable.')) return
    const res = await fetch(`/api/invites/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
    })
    if (res.ok) setInvites((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'revoked' } : i)))
  }

  async function copyCode(id: string, code: string) {
    await navigator.clipboard.writeText(code)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  async function copyLink(id: string, code: string) {
    const url = `${window.location.origin}/invite/redeem?code=${code}`
    await navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  async function changeRole(id: string, role: string) {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (res.ok) setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)))
  }

  async function toggleActive(id: string, isActive: boolean) {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive }),
    })
    if (res.ok) setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isActive } : u)))
  }

  async function submitPin() {
    if (!pinTarget) return
    if (!/^\d{6}$/.test(pinValue)) {
      setPinError('PIN must be exactly 6 digits')
      return
    }
    setPinSaving(true)
    setPinError(null)
    try {
      const res = await fetch(`/api/users/${pinTarget.id}/pin`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: pinValue }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPinError(data.error ?? 'Failed to set PIN')
        return
      }
      setPinTarget(null)
      setPinValue('')
    } finally {
      setPinSaving(false)
    }
  }

  async function deleteUser(id: string, name: string) {
    if (!confirm(`Delete ${name}'s account? This can't be undone.`)) return
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' })
    if (res.ok) setUsers((prev) => prev.filter((u) => u.id !== id))
  }

  const reusableLinks = invites.filter((i) => i.isReusable && i.status === 'pending')
  const pendingInvites = invites.filter((i) => !i.isReusable && i.status === 'pending')
  const otherInvites = invites.filter((i) => !i.isReusable && i.status !== 'pending')
  const activeUsers = users.filter((u) => u.role !== 'pending')

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Organisation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          {activeUsers.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium truncate">{u.name}</p>
                <p className="text-xs text-muted-foreground truncate">{u.email}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Select value={u.role} onValueChange={(v) => changeRole(u.id, v)}>
                  <SelectTrigger className="h-7 w-[7.5rem] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sales">Sales</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="operations">Operations</SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant={u.isActive ? 'outline' : 'secondary'} className="text-[10px]">
                  {u.isActive ? 'Active' : 'Inactive'}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Set/reset rep-form PIN"
                  onClick={() => {
                    setPinTarget(u)
                    setPinValue('')
                    setPinError(null)
                  }}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title={u.isActive ? 'Deactivate' : 'Reactivate'}
                  onClick={() => toggleActive(u.id, !u.isActive)}
                >
                  <Ban className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-rose-600 hover:text-rose-700"
                  title="Delete"
                  onClick={() => deleteUser(u.id, u.name)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {activeUsers.length === 0 && <p className="text-sm text-muted-foreground">No team members yet.</p>}
        </div>

        {pendingInvites.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Pending invites</p>
            {pendingInvites.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">{i.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{i.role}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <code className="rounded bg-muted px-2 py-1 text-xs">{i.code}</code>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copyCode(i.id, i.code)} title="Copy code">
                    {copiedId === i.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600 hover:text-rose-700" onClick={() => revokeInvite(i.id)} title="Revoke">
                    <Ban className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {reusableLinks.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Reusable invite links</p>
            {reusableLinks.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium capitalize">{i.role} link</p>
                  <p className="text-xs text-muted-foreground truncate">/invite/redeem?code={i.code}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copyLink(i.id, i.code)} title="Copy link">
                    {copiedId === i.id ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600 hover:text-rose-700" onClick={() => revokeInvite(i.id)} title="Revoke">
                    <Ban className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-md border p-3 space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <UserPlus className="h-3.5 w-3.5" /> Invite a team member
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                className="h-8"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Designation</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={generateInviteLink} disabled={linkSaving}>
              {linkSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              Create invite link
            </Button>
            <Button size="sm" onClick={generateInvite} disabled={saving || !form.name}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Generate invite code
            </Button>
          </div>
        </div>

        {otherInvites.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {otherInvites.filter((i) => i.status === 'redeemed').length} invite(s) redeemed ·{' '}
            {otherInvites.filter((i) => i.status === 'revoked').length} revoked
          </p>
        )}
      </CardContent>

      <Dialog open={!!pinTarget} onOpenChange={(o) => !o && setPinTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set PIN for {pinTarget?.name}</DialogTitle>
            <DialogDescription>
              Used to sign in on your team&apos;s own rep link, the lightweight lead-update form. Reps enter
              their name and this 6-digit PIN, nothing else. Make sure {pinTarget?.name}&apos;s name is spelled
              exactly the way they&apos;ll type it; names must be unique within your team.
              {orgSlug && (
                <>
                  {' '}Your link is{' '}
                  <code className="text-xs">{`/rep/${orgSlug}`}</code> — share it with them.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <Input
            className="h-9 tracking-widest"
            inputMode="numeric"
            maxLength={6}
            placeholder="6-digit PIN"
            value={pinValue}
            onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          {pinError && <p className="text-xs text-rose-600">{pinError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPinTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitPin} disabled={pinSaving || pinValue.length !== 6}>
              {pinSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
