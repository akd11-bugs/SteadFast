import { NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/session'
import { checkRateLimit } from '@/lib/rateLimit'
import { recognizeCardText } from '@/lib/cardScan/visionOcr'
import { extractCardEntities } from '@/lib/cardScan/entityExtraction'

export const dynamic = 'force-dynamic'

// Authenticated (unlike the public intake routes) — a logged-in rep scans a
// card they were just handed, from their own phone. Generous per-user cap
// rather than the public form's tight 5/15min: lower abuse risk behind a
// real session, but Cloud Vision is still a cost-bearing external call.
const MAX_SCANS_PER_HOUR = 30
const WINDOW_MS = 60 * 60 * 1000
// Generous for a phone photo of a business card — this is the one cap on
// request size before forwarding to a paid, per-call-billed Vision API;
// next.config.mjs's bodySizeLimit only applies to Server Actions, not plain
// Route Handlers like this one.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

// Does the Vision OCR call only — never creates a Lead/Person. Field
// extraction and merging into the lead-creation form happens client-side
// (extractLeadFields/extractLinks over the returned text), consistent with
// "auto-fill, rep reviews, rep submits": there is no server-side auto-save
// path here.
export async function POST(req: Request) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user

  const rateLimit = checkRateLimit(`scan-card:${user.id}`, MAX_SCANS_PER_HOUR, WINDOW_MS)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many scans this hour. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'Expected an image upload.' }, { status: 400 })
  }

  const bytes = Buffer.from(await req.arrayBuffer())
  if (bytes.length === 0) {
    return NextResponse.json({ error: 'Empty image.' }, { status: 400 })
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'Image too large (max 8MB).' }, { status: 413 })
  }

  let text: string
  try {
    text = (await recognizeCardText(bytes)).text
  } catch (err) {
    console.error('scan-card OCR failed:', err)
    return NextResponse.json(
      { error: `Could not read that card. (${err instanceof Error ? err.message : String(err)})` },
      { status: 502 },
    )
  }

  // Best-effort: a stronger model for company/contact-name extraction than
  // the client's on-device NER manages on short, fragmented card text (see
  // lib/cardScan/entityExtraction.ts). Never fails the whole scan if this
  // one call errors (quota, transient network) — the client still has the
  // OCR text and falls back to its own on-device extraction over it.
  let entities: { company?: string; poc?: string } = {}
  try {
    entities = await extractCardEntities(text)
  } catch (err) {
    console.error('scan-card entity extraction failed, falling back to on-device NER:', err)
  }

  return NextResponse.json({ text, entities })
}
