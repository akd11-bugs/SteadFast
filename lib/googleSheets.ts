import { JWT } from 'google-auth-library'

// Env vars often mangle a literal newline in a multiline private key into an
// escaped "\n" sequence, and some hosting dashboards' paste boxes silently
// convert line endings to CRLF — either one leaves Node's OpenSSL 3 PEM
// decoder unable to parse an otherwise-correct key
// (error:1E08010C:DECODER routines::unsupported). Normalize all of it away.
function normalizePrivateKey(raw: string): string {
  let key = raw.trim()
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1)
  }
  return key.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

// One service account for the whole deployment — every org shares it rather
// than bringing their own (see components/settings/OrgSheetConnectorCard.tsx):
// an org admin's entire setup is sharing their sheet with this one email,
// not creating their own GCP project/credentials. Built once and reused
// (unlike a rotatable per-org credential, this one only changes via a
// deploy + restart, so there's no staleness risk in caching it).
//
// Full read+write scope, not read-only: lib/googleSheetWriteback.ts appends
// a row back for every Steadfast-originated lead (see that file's doc
// comment for why this is write-once, never update). An org must re-share
// its sheet with Editor access, not just Viewer, for the append call to
// succeed — Viewer-shared sheets simply get a 403 on append, surfaced by
// the writeback helper's own try/catch rather than failing lead creation.
let client: JWT | null = null

function getClient(): JWT {
  if (client) return client
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  if (!email || !rawKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY are not configured in .env.')
  }
  client = new JWT({ email, key: normalizePrivateKey(rawKey), scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  return client
}

// A Google spreadsheet id is base64url-ish. Anything else (e.g. "<id>/values/A:Z?x=")
// would rewrite the API path and dodge the one-sheet-per-org unique check.
export const SHEET_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/
function sheetPath(spreadsheetId: string): string {
  if (!SHEET_ID_PATTERN.test(spreadsheetId)) throw new Error('Invalid Google Sheet ID')
  return encodeURIComponent(spreadsheetId)
}

// A cell starting with = + - @ (or a tab/CR) is run as a formula under
// USER_ENTERED. Values from public forms must stay text: prefix an apostrophe.
export function sheetSafeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

// Reads a range as a 2D array of cell values (row 0 is whatever's first in
// the range — callers decide whether that's a header row).
export async function getSheetRows(spreadsheetId: string, range: string): Promise<string[][]> {
  const { token } = await getClient().getAccessToken()
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetPath(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google Sheets API error (${res.status}): ${body}`)
  }
  const data = (await res.json()) as { values?: unknown[][] }
  return (data.values ?? []).map((row) => row.map((cell) => (cell == null ? '' : String(cell))))
}

// Appends one row after the sheet's existing data, in the given sheet/tab
// (not a specific range — Sheets' own append API finds the next empty row
// itself, which avoids a race against concurrent writes that a manually
// computed row number would have). `sheetName` is the tab name portion of
// whatever range the org configured (e.g. "Sheet1" out of "Sheet1!A:K").
export async function appendSheetRow(spreadsheetId: string, sheetName: string, row: string[]): Promise<void> {
  const { token } = await getClient().getAccessToken()
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetPath(spreadsheetId)}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values: [row.map(sheetSafeCell)] }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google Sheets append error (${res.status}): ${body}`)
  }
}
