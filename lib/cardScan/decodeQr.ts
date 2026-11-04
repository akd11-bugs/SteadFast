// On-device QR/barcode decoding for a scanned business-card photo. Runs
// fully client-side — no network call, no server cost — unlike the card's
// printed TEXT, which goes through Cloud Vision OCR (lib/cardScan/visionOcr
// client + app/api/leads/scan-card) because on-device text OCR is
// specifically the piece that failed (hung indefinitely) in an earlier
// attempt this session. QR decoding is a much narrower, well-solved
// problem with mature libraries, so it stays on-device.
//
// Two decode paths, tried in order:
// 1. The native BarcodeDetector API, where available — fast, no library
//    weight. Real-world support is partial: Android Chrome supports it,
//    but it's disabled by default on Safari/iOS and unsupported on
//    Firefox (checked at build time against MDN/caniuse — not a stale
//    assumption). iPhone Safari is the majority-practical mobile browser
//    for a business-card-scan feature, so this can never be the ONLY path.
// 2. jsQR (a real npm dependency, pure-JS/canvas-pixel-based, no native
//    API dependency) — the actual reliable path across every browser,
//    including iPhone Safari. This is deliberately NOT treated as a
//    "best effort" fallback; it's the path most scans will actually take.

import jsQR from 'jsqr'

export interface DecodedQr {
  /** The raw string payload decoded from the QR/barcode. */
  raw: string
  /** Parsed vCard fields, if the payload was a vCard (BEGIN:VCARD...). */
  vcard?: {
    name?: string
    email?: string
    phone?: string
    company?: string
    url?: string
  }
  /** The payload itself, if it was a bare URL rather than a vCard. */
  url?: string
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>
    }
  }
}

async function decodeViaBarcodeDetector(bitmap: ImageBitmap): Promise<string | null> {
  if (typeof window === 'undefined' || !window.BarcodeDetector) return null
  try {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
    const results = await detector.detect(bitmap)
    return results[0]?.rawValue ?? null
  } catch {
    // Some browsers advertise the constructor but throw on use (e.g. an
    // unsupported format list) — fall through to jsQR rather than fail.
    return null
  }
}

function decodeViaJsQr(imageData: ImageData): string | null {
  const result = jsQR(imageData.data, imageData.width, imageData.height)
  return result?.data ?? null
}

// A very small, pragmatic vCard line parser — business-card QR codes use a
// handful of common fields (FN/N, EMAIL, TEL, ORG, URL); this is not a full
// vCard spec implementation, just enough to pull the fields this app's
// lead form actually has slots for.
function parseVCard(text: string): DecodedQr['vcard'] {
  const get = (field: string): string | undefined => {
    const re = new RegExp(`^${field}(?:;[^:]*)?:(.*)$`, 'im')
    const match = text.match(re)
    return match?.[1]?.trim() || undefined
  }
  // A vCard URL: field is attacker-controlled (anyone can print a QR code),
  // so it gets the same http(s)-only gate the bare-URL QR path below already
  // has — otherwise a javascript: URI would flow straight into the lead
  // form's link fields with no validation anywhere downstream.
  const rawUrl = get('URL')
  return {
    name: get('FN') ?? get('N'),
    email: get('EMAIL'),
    phone: get('TEL'),
    company: get('ORG'),
    url: rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : undefined,
  }
}

async function decodeRawQr(source: ImageBitmap | ImageData): Promise<string | null> {
  if (source instanceof ImageData) {
    // jsQR needs raw pixel data — BarcodeDetector isn't offered ImageData
    // directly here since this path is only reached when BarcodeDetector
    // was unavailable/failed above.
    return decodeViaJsQr(source)
  }
  const viaNative = await decodeViaBarcodeDetector(source)
  if (viaNative) return viaNative
  // Fall back to jsQR even when BarcodeDetector exists but found nothing —
  // the two decoders have different strengths on real, imperfect photos.
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(source, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return decodeViaJsQr(imageData)
}

// A QR code only needs enough resolution to resolve its own modules, not
// the full photo a modern phone camera produces (commonly 3000-7000px on
// the long edge). Decoding at full size means getImageData() below
// allocates a raw RGBA buffer around 4 bytes/pixel — tens to low hundreds
// of MB for a single frame — on every scan, even though most cards have no
// QR code at all and that allocation finds nothing. This cap keeps that
// buffer small regardless of the source photo's resolution.
const MAX_QR_DECODE_DIMENSION = 1200

async function downscaleForDecode(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const scale = Math.min(1, MAX_QR_DECODE_DIMENSION / Math.max(bitmap.width, bitmap.height))
  if (scale >= 1) return bitmap
  const resized = await createImageBitmap(bitmap, {
    resizeWidth: Math.round(bitmap.width * scale),
    resizeHeight: Math.round(bitmap.height * scale),
  })
  bitmap.close()
  return resized
}

/**
 * Decodes a single captured card photo (a File/Blob from the camera-capture
 * file input) for a QR/barcode payload. Returns null if none is found —
 * most cards have no QR code at all, which is a normal, expected outcome,
 * not an error.
 */
export async function decodeCardQr(photo: Blob): Promise<DecodedQr | null> {
  const fullSize = await createImageBitmap(photo)
  const bitmap = await downscaleForDecode(fullSize)
  const raw = await decodeRawQr(bitmap)
  bitmap.close()
  if (!raw) return null

  if (/^BEGIN:VCARD/i.test(raw.trim())) {
    return { raw, vcard: parseVCard(raw) }
  }
  if (/^https?:\/\//i.test(raw.trim())) {
    return { raw, url: raw.trim() }
  }
  return { raw }
}
