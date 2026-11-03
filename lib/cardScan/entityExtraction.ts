import { JWT } from 'google-auth-library'

// Server-side only. Reuses the exact same service-account JWT pattern as
// lib/cardScan/visionOcr.ts — one GCP service account for the whole
// deployment, just requesting a second Google API under the same
// cloud-platform scope, rather than provisioning anything new.
//
// Why this exists alongside the on-device NER model (lib/aiExtraction.ts's
// extractLeadFields): Xenova/bert-base-NER is a small, general-purpose model
// that's noticeably weaker on business-card text specifically — short,
// fragmented lines with no sentence structure, titles stacked next to names
// with no separating punctuation. Google Cloud Natural Language's entity
// analysis does the same ORGANIZATION/PERSON extraction job with a much
// stronger model, server-side, for a small per-call cost. Scoped to the
// card-scan flow only (see app/api/leads/scan-card/route.ts) — every other
// extraction call site in the app (whiteboard auto-detect, the paste-text
// dialog) keeps using the free on-device model unchanged.

function normalizePrivateKey(raw: string): string {
  let key = raw.trim()
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1)
  }
  return key.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

let client: JWT | null = null

function getClient(): JWT {
  if (client) return client
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  if (!email || !rawKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY are not configured in .env.')
  }
  client = new JWT({ email, key: normalizePrivateKey(rawKey), scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
  return client
}

export interface CardEntities {
  company?: string
  poc?: string
}

/**
 * Sends OCR'd card text to Cloud Natural Language's analyzeEntities and
 * returns the highest-salience ORGANIZATION and PERSON entities, matching
 * the shape extractLeadFields() already returns so callers can merge either
 * result the same way. Throws on a non-2xx response — same convention as
 * recognizeCardText(); callers decide how to degrade (here: fall back to
 * the on-device NER result rather than failing the whole scan).
 */
export async function extractCardEntities(text: string): Promise<CardEntities> {
  const trimmed = text.trim()
  if (!trimmed) return {}

  const { token } = await getClient().getAccessToken()
  const res = await fetch('https://language.googleapis.com/v1/documents:analyzeEntities', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      document: { type: 'PLAIN_TEXT', content: trimmed },
      encodingType: 'UTF8',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Cloud Natural Language API error (${res.status}): ${body}`)
  }

  const data = (await res.json()) as {
    entities?: { name: string; type: string; salience: number }[]
  }
  const entities = data.entities ?? []

  // Highest-salience match per type — salience is Google's own 0..1 estimate
  // of how central an entity is to the document, so on a business card (a
  // handful of short lines) the top-salience ORGANIZATION/PERSON is reliably
  // the card's actual company/contact, not an incidental mention.
  const topOfType = (type: string) =>
    entities.filter((e) => e.type === type).sort((a, b) => b.salience - a.salience)[0]?.name

  return {
    company: topOfType('ORGANIZATION'),
    poc: topOfType('PERSON'),
  }
}
