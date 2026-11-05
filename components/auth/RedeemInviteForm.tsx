'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { signOutForInviteRetry } from '@/app/invite/redeem/actions'

// `alreadySignedInEmail` is set when the visitor already has a live Neon
// Auth session (e.g. she signed in with Google, hit /account-not-found,
// requested to join, and an admin approved her — see
// app/api/invites/redeem/route.ts for why that path must skip password
// creation entirely rather than trying to sign up a second identity for an
// email Neon Auth already has one for).
//
// An invite code carries no email of its own (Invite has no email column —
// a reusable link can't name anyone in advance), so there is nothing to
// compare a live session against. The real risk is someone forwarding an
// invite link and it getting opened on a device/browser signed in under a
// DIFFERENT person's stale Google session — she'd silently join as that
// wrong identity with no indication anything was off. Making the identity
// explicit, with an easy way out, is the only fix available given invites
// are bearer codes by design.
export function RedeemInviteForm({ alreadySignedInEmail }: { alreadySignedInEmail: string | null }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [form, setForm] = useState({
    code: searchParams.get('code') ?? '',
    name: '',
    email: alreadySignedInEmail ?? '',
    password: '',
    confirm: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function redeem() {
    setError(null)
    if (!alreadySignedInEmail && form.password !== form.confirm) {
      setError('Passwords do not match')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/invites/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: form.code.trim(),
          name: form.name,
          ...(alreadySignedInEmail ? {} : { email: form.email, password: form.password }),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to redeem invite')
        return
      }
      router.push(alreadySignedInEmail ? '/' : '/login?redeemed=1')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Join Steadfast</CardTitle>
          <CardDescription>
            {alreadySignedInEmail
              ? `Enter the invite code your admin gave you to finish joining as ${alreadySignedInEmail}.`
              : 'Enter the invite code your admin gave you, and set your login details.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {alreadySignedInEmail && (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
                <span>
                  Joining as <span className="font-medium">{alreadySignedInEmail}</span>
                </span>
                <button
                  type="button"
                  className="shrink-0 underline underline-offset-4 text-muted-foreground hover:text-foreground"
                  onClick={() => signOutForInviteRetry(form.code.trim())}
                >
                  Not you? Sign out
                </button>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="code">Invite code</Label>
              <Input
                id="code"
                autoFocus={!form.code}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. aB3xQ9zK"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                autoFocus={!!form.code}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            {!alreadySignedInEmail && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="min 8 characters"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    value={form.confirm}
                    onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  />
                </div>
              </>
            )}
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <Button
              className="w-full"
              onClick={redeem}
              disabled={
                saving ||
                !form.code ||
                !form.name ||
                (!alreadySignedInEmail && (!form.email || !form.password))
              }
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {alreadySignedInEmail ? 'Finish joining' : 'Create my account'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
