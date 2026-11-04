'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

// Lands here from the link Neon Auth emails for both app/api/settings/
// set-password's "set a password" request and any future plain forgot-
// password request — same reset-password token flow either way, token is
// in the query string (?token=...) per Better Auth's convention.
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/auth-actions/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not reset your password — the link may have expired.')
        return
      }
      router.push('/login?reset=1')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-white/70">
          New password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border-white/15 bg-white/[0.04] text-white placeholder:text-white/30"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm" className="text-white/70">
          Confirm password
        </Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="border-white/15 bg-white/[0.04] text-white placeholder:text-white/30"
        />
      </div>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={saving || !password || !confirm}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#07080c] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Set password
      </button>
    </div>
  )
}
