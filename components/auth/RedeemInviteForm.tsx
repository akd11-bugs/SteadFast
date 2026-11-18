'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthField, AuthNotice, AuthSecondaryButton } from '@/components/auth/AuthControls'
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
      // A crashed request returns HTML, not JSON: still show an error.
      const data = await res.json().catch(() => ({}))
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
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        redeem()
      }}
    >
      {alreadySignedInEmail && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70">
          <span>
            Joining as <span className="font-medium text-white">{alreadySignedInEmail}</span>
          </span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-4 hover:text-white"
            onClick={() => signOutForInviteRetry(form.code.trim())}
          >
            Not you? Sign out
          </button>
        </div>
      )}
      <AuthField id="code" label="Invite code" autoFocus={!form.code} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. aB3xQ9zK" />
      <AuthField id="name" label="Your name" autoComplete="name" autoFocus={!!form.code} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      {!alreadySignedInEmail && (
        <>
          <AuthField id="email" label="Email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <AuthField id="password" label="Password" type="password" autoComplete="new-password" placeholder="min 8 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <AuthField id="confirm" label="Confirm password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </>
      )}
      {error && <AuthNotice tone="error">{error}</AuthNotice>}
      <AuthSecondaryButton
        type="submit"
        className="border-transparent bg-white text-[#07080c] hover:bg-white/90 hover:text-[#07080c]"
        disabled={saving || !form.code || !form.name || (!alreadySignedInEmail && (!form.email || !form.password))}
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {alreadySignedInEmail ? 'Join workspace' : 'Create my account'}
      </AuthSecondaryButton>
    </form>
  )
}
