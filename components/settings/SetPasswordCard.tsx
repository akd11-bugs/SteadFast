'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MailCheck } from 'lucide-react'

// For anyone who signed up/in via Google and has no password on their
// account — lets them add one so they can also sign in with email+password
// later (e.g. if Google sign-in is ever unavailable). Works the same way
// for an account that already has a password (it just resets it), so one
// card covers "set" and "change" without needing to know which applies —
// see app/api/settings/set-password/route.ts for why.
export function SetPasswordCard() {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/set-password', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not send the email — try again.')
        return
      }
      setSent(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Password</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Signed in with Google and don&apos;t have a password yet? Set one so you can also sign in with email and
          password.
        </p>
        {sent ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            <MailCheck className="h-4 w-4 shrink-0" />
            Check your inbox for a link to set your password.
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={handleSend} disabled={sending}>
            {sending ? 'Sending…' : 'Set a password'}
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
