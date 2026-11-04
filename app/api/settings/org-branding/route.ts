import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser, isAdmin } from '@/lib/session'
import { readJsonBody } from '@/lib/http'

export const dynamic = 'force-dynamic'

// Small enough to inline as a data: URI and store directly on the
// Organization row (logoDataUrl) — no object storage needed, per that
// column's own doc comment in prisma/schema.prisma. 300KB covers a
// reasonably-sized PNG/SVG logo; base64 inflates it by ~1.33x again on top.
const MAX_LOGO_BYTES = 300 * 1024
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export async function GET() {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user

  const org = await prisma.organization.findUnique({
    where: { id: user.orgId },
    select: { name: true, logoUrl: true, logoDataUrl: true, brandColor: true },
  })
  return NextResponse.json({ org })
}

export async function POST(req: Request) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body

  const name = String(body.name ?? '').trim()
  if (!name) {
    return NextResponse.json({ error: 'Organization name is required' }, { status: 400 })
  }
  if (name.length > 100) {
    return NextResponse.json({ error: 'Organization name is too long (max 100 characters)' }, { status: 400 })
  }

  const logoDataUrl = body.logoDataUrl === null ? null : body.logoDataUrl ? String(body.logoDataUrl) : undefined
  if (logoDataUrl) {
    if (!logoDataUrl.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Logo must be an image file' }, { status: 400 })
    }
    if (logoDataUrl.length > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: 'Logo is too large (max ~300KB)' }, { status: 413 })
    }
  }

  const brandColor = body.brandColor === null ? null : body.brandColor ? String(body.brandColor) : undefined
  if (brandColor && !HEX_COLOR_PATTERN.test(brandColor)) {
    return NextResponse.json({ error: 'Accent color must be a hex code like #5b8cff' }, { status: 400 })
  }

  const org = await prisma.organization.update({
    where: { id: user.orgId },
    data: {
      name,
      ...(logoDataUrl !== undefined && { logoDataUrl }),
      ...(brandColor !== undefined && { brandColor }),
    },
    select: { name: true, logoUrl: true, logoDataUrl: true, brandColor: true },
  })
  return NextResponse.json({ org })
}
