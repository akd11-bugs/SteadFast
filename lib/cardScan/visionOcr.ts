import { JWT } from 'google-auth-library'

// Server-side only — never import this from a client component. Reuses the
// same GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY credential lib/googleSheets.ts
// already uses (one service account for the whole deployment, same as the
// Sheets sync), just with Cloud Vision's own scope — avoids provisioning a
// second GCP service account for one more read-only API call.

// Same normalization lib/googleSheets.ts uses — a private key pasted into
// an env var frequently arrives with its newlines mangled.
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

export interface VisionOcrResult {
  /** Full recognized text block, newline-joined — what callers feed to extractLeadFields()/extractLinks(). */
  text: string
}

/**
 * Sends a single image (raw bytes) to Cloud Vision's TEXT_DETECTION feature
 * and returns the recognized text. Throws on any non-2xx response — callers
 * (the API route) are responsible for turning that into a client-facing
 * error, same convention as lib/googleSheets.ts's getSheetRows().
 */
export async function recognizeCardText(imageBytes: Buffer): Promise<VisionOcrResult> {
  const { token } = await getClient().getAccessToken()
  const res = await fetch('https://vision.googleapis.com/v1/images:annotate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBytes.toString('base64') },
          features: [{ type: 'TEXT_DETECTION' }],
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Cloud Vision API error (${res.status}): ${body}`)
  }
  const data = (await res.json()) as {
    responses?: { fullTextAnnotation?: { text?: string }; error?: { message?: string } }[]
  }
  const response = data.responses?.[0]
  if (response?.error) {
    throw new Error(`Cloud Vision API error: ${response.error.message}`)
  }
  return { text: response?.fullTextAnnotation?.text ?? '' }
}
