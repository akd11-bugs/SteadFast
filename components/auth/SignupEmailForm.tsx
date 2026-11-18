'use client'

import { useState } from 'react'
import { AuthField, AuthNotice, AuthSecondaryButton } from '@/components/auth/AuthControls'
import { Loader2, MailCheck } from 'lucide-react'

export function SignupEmailForm() {
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function requestLink() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/signup/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to send the link')
        return
      }
      setSent(true)
    } finally {
      setSaving(false)
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-center text-sm text-white/60">
        <MailCheck className="h-8 w-8 text-emerald-400" />
        <p>Sent to {email}. The link expires in 30 minutes.</p>
      </div>
    )
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        requestLink()
      }}
    >
      <AuthField id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      {error && <AuthNotice tone="error">{error}</AuthNotice>}
      <AuthSecondaryButton type="submit" disabled={saving || !email}>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Send me a signup link
      </AuthSecondaryButton>
    </form>
  )
}
