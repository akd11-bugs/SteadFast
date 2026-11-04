'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { OrgLogo } from '@/components/branding/OrgLogo'
import { Loader2, Upload, X } from 'lucide-react'

const MAX_LOGO_BYTES = 300 * 1024

// Admin-only (enforced server-side too, see app/api/settings/org-branding)
// card for the org's own name/logo/accent — the white-label fields that
// already exist on Organization and that OrgLogo already knows how to
// render (Sidebar, TopBar, auth pages), but that nothing let an admin set
// until now. router.refresh() after a save so Sidebar/TopBar (both Server
// Components reading SessionUser) pick up the change immediately rather
// than waiting for the next full navigation.
export function OrgBrandingCard() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [brandColor, setBrandColor] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings/org-branding')
      .then((res) => res.json())
      .then((data) => {
        setName(data.org?.name ?? '')
        setLogoDataUrl(data.org?.logoDataUrl ?? null)
        setLogoUrl(data.org?.logoUrl ?? null)
        setBrandColor(data.org?.brandColor ?? null)
      })
      .finally(() => setLoading(false))
  }, [])

  function handleLogoFile(file: File) {
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError('Logo must be an image file')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('Logo is too large (max ~300KB) — try a smaller or more compressed image')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setLogoDataUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/org-branding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, logoDataUrl, brandColor }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not save')
        return
      }
      setSaved(true)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Branding</CardTitle>
        </CardHeader>
        <CardContent>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Branding</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Your organization&apos;s name and logo, shown in the sidebar and top bar instead of the default product
          name.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="orgName">Organization name</Label>
          <Input id="orgName" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </div>

        <div className="space-y-1.5">
          <Label>Logo</Label>
          <div className="flex items-center gap-3">
            <OrgLogo org={{ name: name || 'Org', logoUrl, logoDataUrl, brandColor }} size={40} className="rounded-md" />
            <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" />
              Upload logo
            </Button>
            {logoDataUrl && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setLogoDataUrl(null)}>
                <X className="h-3.5 w-3.5" />
                Remove
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) handleLogoFile(file)
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">PNG, JPG, or SVG — up to ~300KB.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="brandColor">Accent color</Label>
          <div className="flex items-center gap-2">
            <input
              id="brandColor"
              type="color"
              value={brandColor ?? '#5b8cff'}
              onChange={(e) => setBrandColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border bg-transparent p-0.5"
            />
            <Input
              value={brandColor ?? ''}
              onChange={(e) => setBrandColor(e.target.value || null)}
              placeholder="#5b8cff"
              className="w-32"
            />
            {brandColor && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setBrandColor(null)}>
                Reset
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Used behind your logo&apos;s initials until you upload one.</p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {saved && !saving && <span className="text-xs text-emerald-600">Saved</span>}
        </div>
      </CardContent>
    </Card>
  )
}
