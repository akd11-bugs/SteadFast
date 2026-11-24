// Day and month boundaries in India time. The server clock runs in UTC, so
// `new Date(y, m, d)` would put midnight 5h30m late and count a deal won at
// 03:00 IST on the 1st in the previous month. India has no daylight saving,
// so a fixed offset is exact.
// shortcut: one fixed zone for every org, add Organization.timeZone when a customer outside India signs up.
const OFFSET_MS = 330 * 60_000

/** IST calendar fields of an instant. `m` is 0-based, `dow` 0 = Sunday. */
export function istParts(at: Date = new Date()) {
  const t = new Date(at.getTime() + OFFSET_MS)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), dow: t.getUTCDay() }
}

/** The instant of y-m-d h:min IST. Month and day may overflow, as in Date.UTC. */
export function istDate(y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0): Date {
  return new Date(Date.UTC(y, m, d, h, min, s, ms) - OFFSET_MS)
}

/** Last millisecond of y-m-d IST. */
export function istDayEnd(y: number, m: number, d: number): Date {
  return istDate(y, m, d, 23, 59, 59, 999)
}

/** First and last instant of the IST calendar month containing `at`. */
export function istMonth(at: Date = new Date()) {
  const { y, m } = istParts(at)
  return { start: istDate(y, m, 1), end: istDayEnd(y, m + 1, 0) }
}
