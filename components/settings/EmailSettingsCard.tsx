'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2 } from 'lucide-react'

export function EmailSettingsCard() {
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(false)
  const [currentAddress, setCurrentAddress] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState(false)
  const [saving, setSaving] = useState(false)

  // The OAuth callback redirects back here with one of these params —
  // refetch so the card reflects whatever actually got saved, rather than
  // trusting the redirect alone.
  const justConnected = searchParams.get('gmailConnected') === '1'
  const connectError = searchParams.get('gmailError') === '1'

  useEffect(() => {
    fetch('/api/settings/email')
      .then((res) => res.json())
      .then((data) => {
        setConfigured(!!data.configured)
        setCurrentAddress(data.emailFromAddress ?? null)
      })
      .finally(() => setLoading(false))
  }, [justConnected])

  async function handleRemove() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/email', { method: 'DELETE' })
      // Only show "disconnected" once the token is actually gone.
      if (!res.ok) {
        setRemoveError(true)
        return
      }
      setRemoveError(false)
      setConfigured(false)
      setCurrentAddress(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Your email</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Connect your own Gmail so emails sent by workflow rules (and future automated sends) come from your own
          address instead of the shared mailbox.
        </p>
        {!loading && configured && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Connected as {currentAddress}
          </div>
        )}
        {removeError && <p className="text-sm text-destructive">Could not disconnect — try again.</p>}
        {connectError && (
          <p className="text-sm text-destructive">Could not connect that Gmail account — try again.</p>
        )}
        <div className="flex gap-2">
          <Button size="sm" asChild>
            <a href="/api/settings/email/oauth/start">{configured ? 'Reconnect Gmail' : 'Connect Gmail'}</a>
          </Button>
          {configured && (
            <Button size="sm" variant="outline" onClick={handleRemove} disabled={saving}>
              Disconnect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
